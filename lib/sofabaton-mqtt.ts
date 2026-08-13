import { EventEmitter } from 'events';
import mqtt, { MqttClient } from 'mqtt';

/**
 * SofaBaton X2 MQTT client (device-centric).
 *
 * Verified behaviour of this hub firmware:
 *   - `device/{mac}/list_request` {"data":"device_list"}  -> `device/{mac}/list`
 *       {"data":[{"device_id","device_name"}]}
 *   - `device/{mac}/keys_request` {"data":{"device_id":N}} -> `device/{mac}/keys_list`
 *       {"data":[{"key_id","key_name"}],"device_id":N,"key_count":K}
 *   - `device/{mac}/keys_control` {"data":{"device_id":N,"key_id":M}}
 *       -> the hub actuates that device/key (confirmed on a real IR device) and
 *          also echoes {"device_id":N,"key_id":M} on `{mac}/up`.
 *   - `{mac}/up` {"device_id":N,"key_id":M}
 *       -> emitted whenever a key is actuated (physical remote press of an
 *          MQTT-bound key, or one of our keys_control publishes).
 *
 * The hub is single-threaded, so publishes are serialized with a small gap.
 */

const TOPIC = {
  DEVICE_LIST_REQUEST: 'device/{mac}/list_request',
  DEVICE_LIST: 'device/{mac}/list',
  DEVICE_KEYS_REQUEST: 'device/{mac}/keys_request',
  DEVICE_KEYS_LIST: 'device/{mac}/keys_list',
  DEVICE_KEYS_CONTROL: 'device/{mac}/keys_control',
  UP: '{mac}/up',
} as const;

const PUBLISH_GAP_MS = 200;

export interface SofaDevice {
  id: number;
  name: string;
}

export interface SofaKey {
  id: number;
  name: string;
}

export interface KeyEvent {
  deviceId: number;
  keyId: number;
  deviceName: string;
  keyName: string;
}

export interface SofaBatonMqttOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  mac: string;
  logger?: (message: string) => void;
}

export declare interface SofaBatonMqtt {
  on(event: 'connect', listener: () => void): this;
  on(event: 'reconnect', listener: () => void): this;
  on(event: 'offline', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'devices', listener: (devices: SofaDevice[]) => void): this;
  on(event: 'keys', listener: (deviceId: number, keys: SofaKey[]) => void): this;
  on(event: 'keyEvent', listener: (event: KeyEvent) => void): this;
}

export class SofaBatonMqtt extends EventEmitter {
  private readonly opts: SofaBatonMqttOptions;

  private client: MqttClient | null = null;

  private devices = new Map<number, SofaDevice>();

  private keysByDevice = new Map<number, SofaKey[]>();

  private publishChain: Promise<void> = Promise.resolve();

  constructor(opts: SofaBatonMqttOptions) {
    super();
    this.opts = opts;
  }

  // --- Connection ---

  connect(): Promise<void> {
    if (this.client) {
      return Promise.resolve();
    }
    const url = `mqtt://${this.opts.host}:${this.opts.port}`;
    this.log(`Connecting to broker ${url}`);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const client = mqtt.connect(url, {
        username: this.opts.username || undefined,
        password: this.opts.password || undefined,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clientId: `homey-sofabaton-${this.opts.mac}-${Math.floor(Date.now() / 1000)}`,
        clean: true,
        resubscribe: true,
      });
      this.client = client;

      client.on('connect', () => {
        this.log('Broker connected');
        // Subscribe BEFORE resolving connect(), so no request (device list,
        // keys, …) can be published before we are listening for the response.
        this.subscribeAll()
          .then(() => {
            if (!settled) {
              settled = true;
              resolve();
            }
            this.emit('connect');
          })
          .catch((err: Error) => {
            this.log(`Subscribe failed: ${err.message}`);
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
      });
      client.on('reconnect', () => this.emit('reconnect'));
      client.on('offline', () => {
        this.log('Broker offline');
        this.emit('offline');
      });
      client.on('message', (topic: string, message: Buffer) => this.handleMessage(topic, message));
      client.on('error', (error: Error) => {
        this.log(`Broker error: ${error.message}`);
        this.emit('error', error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    const client = this.client;
    this.client = null;
    await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    this.log('Disconnected');
  }

  isConnected(): boolean {
    return this.client !== null && this.client.connected;
  }

  private async subscribeAll(): Promise<void> {
    if (!this.client) {
      return;
    }
    const topics = [
      this.topic(TOPIC.UP),
      this.topic(TOPIC.DEVICE_LIST),
      this.topic(TOPIC.DEVICE_KEYS_LIST),
    ];
    await this.client.subscribeAsync(topics);
    this.log(`Subscribed to ${topics.length} topics`);
  }

  // --- Devices & keys ---

  /**
   * Seed the in-memory caches from persisted data so autocompletes and event
   * names work even before (or without) a successful live query. Live query
   * responses overwrite these later.
   */
  hydrate(devices: SofaDevice[], keysByDevice: Record<string, SofaKey[]>): void {
    for (const device of devices) {
      if (device && Number.isFinite(device.id)) {
        this.devices.set(device.id, device);
      }
    }
    for (const [id, keys] of Object.entries(keysByDevice || {})) {
      this.keysByDevice.set(Number(id), keys);
    }
    this.log(`Hydrated ${this.devices.size} devices from cache`);
  }

  getDevices(): SofaDevice[] {
    return Array.from(this.devices.values());
  }

  getDeviceKeys(deviceId: number): SofaKey[] {
    return this.keysByDevice.get(deviceId) ?? [];
  }

  /** Request the device list and resolve with it (falls back to cache on timeout). */
  fetchDevices(timeoutMs = 3000): Promise<SofaDevice[]> {
    return new Promise((resolve) => {
      let done = false;
      const onDevices = (devices: SofaDevice[]): void => {
        finish(devices);
      };
      const finish = (result: SofaDevice[]): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        this.off('devices', onDevices);
        resolve(result);
      };
      const timer = setTimeout(() => finish(this.getDevices()), timeoutMs);
      this.on('devices', onDevices);
      this.publish(TOPIC.DEVICE_LIST_REQUEST, { data: 'device_list' }).catch(() => finish(this.getDevices()));
    });
  }

  /** Request the keys for a device and resolve with them (falls back to cache on timeout). */
  fetchDeviceKeys(deviceId: number, timeoutMs = 3000): Promise<SofaKey[]> {
    return new Promise((resolve) => {
      let done = false;
      const onKeys = (id: number, keys: SofaKey[]): void => {
        if (id === deviceId) {
          finish(keys);
        }
      };
      const finish = (result: SofaKey[]): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        this.off('keys', onKeys);
        resolve(result);
      };
      const timer = setTimeout(() => finish(this.getDeviceKeys(deviceId)), timeoutMs);
      this.on('keys', onKeys);
      this.publish(TOPIC.DEVICE_KEYS_REQUEST, { data: { device_id: deviceId } })
        .catch(() => finish(this.getDeviceKeys(deviceId)));
    });
  }

  /** Send (actuate) a device key. */
  async sendKey(deviceId: number, keyId: number): Promise<void> {
    await this.publish(TOPIC.DEVICE_KEYS_CONTROL, {
      data: { device_id: deviceId, key_id: keyId },
    });
  }

  /**
   * Fetch the device list and every device's keys so autocompletes and event
   * names are populated. Tolerant of the hub's occasional non-responses.
   */
  async warmUp(): Promise<void> {
    // Shorter timeouts and no retry — when the hub is awake it answers in well
    // under a second, so this keeps the sequential sweep snappy. Devices that
    // don't answer are fetched lazily on demand later.
    const devices = await this.fetchDevices(2500);
    for (const device of devices) {
      // eslint-disable-next-line no-await-in-loop
      await this.fetchDeviceKeys(device.id, 2000);
    }
    this.log(`Warm-up done: ${this.devices.size} devices`);
  }

  /** Resolve human-readable names for a device/key pair from cache. */
  lookupNames(deviceId: number, keyId: number): { deviceName: string; keyName: string } {
    const device = this.devices.get(deviceId);
    const key = this.getDeviceKeys(deviceId).find((k) => k.id === keyId);
    return {
      deviceName: device ? device.name : `Device ${deviceId}`,
      keyName: key ? key.name : `Key ${keyId}`,
    };
  }

  // --- Incoming ---

  private handleMessage(topic: string, message: Buffer): void {
    let payload: unknown;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      return;
    }
    if (typeof payload !== 'object' || payload === null) {
      return;
    }
    const data = payload as Record<string, unknown>;

    if (topic === this.topic(TOPIC.DEVICE_LIST)) {
      this.onDeviceList(data);
    } else if (topic === this.topic(TOPIC.DEVICE_KEYS_LIST)) {
      this.onDeviceKeys(data);
    } else if (topic === this.topic(TOPIC.UP)) {
      this.onUp(data);
    }
  }

  private onDeviceList(payload: Record<string, unknown>): void {
    const list = Array.isArray(payload.data) ? payload.data : [];
    this.devices.clear();
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }
      const item = raw as Record<string, unknown>;
      const id = Number(item.device_id);
      if (!Number.isFinite(id)) {
        continue;
      }
      this.devices.set(id, { id, name: String(item.device_name ?? `Device ${id}`) });
    }
    this.log(`Device list: ${this.devices.size} devices`);
    this.emit('devices', this.getDevices());
  }

  private onDeviceKeys(payload: Record<string, unknown>): void {
    const deviceId = Number(payload.device_id);
    if (!Number.isFinite(deviceId)) {
      return;
    }
    const list = Array.isArray(payload.data) ? payload.data : [];
    const keys: SofaKey[] = [];
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }
      const item = raw as Record<string, unknown>;
      const id = Number(item.key_id);
      if (!Number.isFinite(id)) {
        continue;
      }
      keys.push({ id, name: String(item.key_name ?? `Key ${id}`) });
    }
    this.keysByDevice.set(deviceId, keys);
    this.emit('keys', deviceId, keys);
  }

  private onUp(payload: Record<string, unknown>): void {
    const deviceId = Number(payload.device_id);
    const keyId = Number(payload.key_id);
    if (!Number.isFinite(deviceId) || !Number.isFinite(keyId)) {
      return;
    }
    // Learn newly-seen device/key from the (reliable) /up event, so a brand-new
    // MQTT button shows up in Flow dropdowns the moment it is pressed — without
    // depending on the flaky list query. Real names fill in on the next refresh.
    this.learnFromEvent(deviceId, keyId);

    const { deviceName, keyName } = this.lookupNames(deviceId, keyId);
    this.log(`Key event: ${deviceName} · ${keyName} (${deviceId}/${keyId})`);
    this.emit('keyEvent', { deviceId, keyId, deviceName, keyName });
  }

  private learnFromEvent(deviceId: number, keyId: number): void {
    let needsRealNames = false;

    if (!this.devices.has(deviceId)) {
      this.devices.set(deviceId, { id: deviceId, name: `Device ${deviceId}` });
      this.emit('devices', this.getDevices());
      needsRealNames = true;
    }

    const keys = this.keysByDevice.get(deviceId) ?? [];
    const existing = keys.find((k) => k.id === keyId);
    if (!existing) {
      keys.push({ id: keyId, name: `Key ${keyId}` });
      this.keysByDevice.set(deviceId, keys);
      this.emit('keys', deviceId, keys);
      needsRealNames = true;
    } else if (/^(Key|Device) \d+$/.test(existing.name)) {
      // Learned earlier with only a placeholder name — try again now.
      needsRealNames = true;
    }

    if (needsRealNames) {
      // The hub is awake right now (it just processed this press), so this is
      // the best moment to fetch the real device/key names. A successful reply
      // overwrites the placeholders via onDeviceKeys.
      this.fetchDeviceKeys(deviceId).catch(() => undefined);
    }
  }

  // --- Helpers ---

  private topic(template: string): string {
    return template.replace('{mac}', this.opts.mac);
  }

  private publish(template: string, payload: unknown): Promise<void> {
    const run = async (): Promise<void> => {
      if (!this.client) {
        throw new Error('Not connected to broker');
      }
      const topic = this.topic(template);
      const message = JSON.stringify(payload);
      this.log(`TX ${topic} ${message}`);
      await this.client.publishAsync(topic, message);
      await SofaBatonMqtt.delay(PUBLISH_GAP_MS);
    };
    const next = this.publishChain.then(run, run);
    this.publishChain = next.catch(() => undefined);
    return next;
  }

  private log(message: string): void {
    if (this.opts.logger) {
      this.opts.logger(`[SofaBaton MQTT] ${message}`);
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
