'use strict';

import Homey from 'homey';
import {
  SofaBatonMqtt, KeyEvent, SofaDevice, SofaKey,
} from '../../lib/sofabaton-mqtt';

interface HubSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  mac: string;
  paused?: boolean;
}

module.exports = class HubDevice extends Homey.Device {

  private client: SofaBatonMqtt | null = null;

  async onInit(): Promise<void> {
    // Migrate existing devices that were paired before these capabilities
    // existed (updating an app does not retro-add capabilities).
    if (!this.hasCapability('last_button')) {
      await this.addCapability('last_button').catch((err: Error) => this.error(err));
    }
    if (!this.hasCapability('refresh_devices')) {
      await this.addCapability('refresh_devices').catch((err: Error) => this.error(err));
    }
    if (!this.hasCapability('pause')) {
      await this.addCapability('pause').catch((err: Error) => this.error(err));
    }

    // Reflect the stored "paused" setting on the card switch so both agree.
    await this.setCapabilityValue('pause', this.getSetting('paused') === true)
      .catch((err: Error) => this.error(err));

    // "Refresh devicelist" button on the device card. Run in the background and
    // return immediately — warm-up can exceed Homey's 10s capability timeout.
    this.registerCapabilityListener('refresh_devices', async () => {
      this.refreshCatalog().catch((err: Error) => this.error(err));
    });

    // "Pause connection" switch on the device card — a one-tap shortcut for the
    // same thing as the "paused" setting (release the single-client hub for the
    // SofaBaton phone app).
    this.registerCapabilityListener('pause', async (value: boolean) => {
      await this.applyPause(value === true);
    });

    await this.connectClient();
  }

  /** Access the connected MQTT client (used by flow-card run listeners). */
  getClient(): SofaBatonMqtt {
    if (!this.client) {
      throw new Error('SofaBaton hub is not connected');
    }
    return this.client;
  }

  private async connectClient(): Promise<void> {
    const settings = this.getSettings() as HubSettings;

    if (settings.paused) {
      // Paused on purpose: stay AVAILABLE (so the "Pause connection" switch on
      // the card stays usable — an unavailable device's controls are disabled)
      // but don't open a connection. The switch being ON is the paused state.
      if (this.hasCapability('pause')) {
        await this.setCapabilityValue('pause', true).catch((err: Error) => this.error(err));
      }
      return;
    }

    if (!settings.host || !settings.mac) {
      await this.setUnavailable(this.homey.__('configure_prompt'));
      return;
    }

    this.client = new SofaBatonMqtt({
      host: settings.host,
      port: Number(settings.port) || 1883,
      username: settings.username || undefined,
      password: settings.password || undefined,
      mac: settings.mac,
      logger: (message: string) => this.log(message),
    });

    // Seed caches from the persisted store so the Flow dropdowns work even
    // when the hub's (flaky) list query is not answering. Live query responses
    // overwrite these and are persisted again below.
    const storedDevices = (this.getStoreValue('sofaDevices') as SofaDevice[] | null) || [];
    const storedKeys = (this.getStoreValue('sofaKeys') as Record<string, SofaKey[]> | null) || {};
    this.client.hydrate(storedDevices, storedKeys);

    this.client.on('devices', (devices: SofaDevice[]) => {
      this.setStoreValue('sofaDevices', devices).catch((err: Error) => this.error(err));
    });
    this.client.on('keys', (deviceId: number, keys: SofaKey[]) => {
      const all = (this.getStoreValue('sofaKeys') as Record<string, SofaKey[]> | null) || {};
      all[String(deviceId)] = keys;
      this.setStoreValue('sofaKeys', all).catch((err: Error) => this.error(err));
    });

    this.client.on('connect', () => {
      this.setAvailable().catch((err: Error) => this.error(err));
    });
    this.client.on('offline', () => {
      this.setUnavailable(this.homey.__('broker_offline')).catch((err: Error) => this.error(err));
    });
    this.client.on('error', (err: Error) => this.error(`Client error: ${err.message}`));
    this.client.on('keyEvent', (event: KeyEvent) => this.onKeyEvent(event));

    try {
      await this.client.connect();
      await this.setAvailable();
      // Only fetch the full catalog when nothing is cached yet. The hub's query
      // bridge is fragile and shared with the SofaBaton phone app, so once we
      // have a cached list we stay quiet and serve autocompletes from it.
      if (this.client.getDevices().length === 0) {
        this.log('No cached devices — fetching catalog once');
        this.client.warmUp().catch((err: Error) => this.error(`Warm-up failed: ${err.message}`));
      } else {
        this.log(`Using ${this.client.getDevices().length} cached devices (quiet mode)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.setUnavailable(`${this.homey.__('cannot_reach_broker')}: ${message}`);
    }
  }

  /** Force a one-off catalog refresh from the hub (used by the settings toggle). */
  async refreshCatalog(): Promise<void> {
    if (!this.client) {
      return;
    }
    this.log('Manual catalog refresh requested');
    await this.client.warmUp();
  }

  /** Disconnect from the broker so the phone app can use the hub alone. */
  private async pause(): Promise<void> {
    this.log('Paused — releasing the hub');
    if (this.client) {
      await this.client.disconnect().catch((err: Error) => this.error(err));
      this.client = null;
    }
    // Stay available so the card switch remains operable; the switch being ON
    // signals "paused". (setUnavailable would grey out the switch → no way back.)
    await this.setCapabilityValue('pause', true).catch((err: Error) => this.error(err));
  }

  /**
   * Apply a paused/unpaused state from either surface (the card switch or the
   * "paused" setting) and keep both in sync. setSettings() from device code
   * does not re-fire onSettings, so there is no feedback loop here.
   */
  private async applyPause(paused: boolean): Promise<void> {
    if (this.getCapabilityValue('pause') !== paused) {
      await this.setCapabilityValue('pause', paused).catch((err: Error) => this.error(err));
    }
    if ((this.getSetting('paused') === true) !== paused) {
      await this.setSettings({ paused }).catch((err: Error) => this.error(err));
    }

    if (paused) {
      await this.pause();
    } else {
      // Un-pausing usually means the user just edited devices in the phone app,
      // so reconnect and refresh the catalog to pick up any changes.
      await this.reconnect();
      await this.refreshCatalog().catch((err: Error) => this.error(err));
    }
  }

  private onKeyEvent(event: KeyEvent): void {
    // Show just the key name on the tile (e.g. "Milo gåtur"), not "MQTT · …".
    this.setCapabilityValue('last_button', event.keyName).catch((err: Error) => this.error(err));

    const driver = this.driver as unknown as {
      triggerButtonPressed: (device: Homey.Device, event: KeyEvent) => void;
      triggerAnyButtonPressed: (device: Homey.Device, event: KeyEvent) => void;
    };
    driver.triggerButtonPressed(this, event);
    driver.triggerAnyButtonPressed(this, event);
  }

  async onSettings(event: {
    changedKeys: string[];
    newSettings: { [key: string]: boolean | string | number | undefined | null };
  }): Promise<void> {
    // "Pause" checkbox in settings: same effect as the card switch. Route both
    // through applyPause so the switch and the setting stay in agreement.
    if (event.changedKeys.includes('paused')) {
      const paused = event.newSettings.paused === true;
      this.homey.setTimeout(() => {
        this.applyPause(paused).catch((err: Error) => this.error(err));
      }, 300);
      return;
    }

    // Broker settings changed → reconnect.
    const brokerKeys = ['host', 'port', 'username', 'password', 'mac'];
    if (event.changedKeys.some((k) => brokerKeys.includes(k))) {
      this.homey.setTimeout(() => {
        this.reconnect().catch((err: Error) => this.error(err));
      }, 500);
    }
  }

  private async reconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect().catch((err: Error) => this.error(err));
      this.client = null;
    }
    await this.connectClient();
  }

  async onUninit(): Promise<void> {
    await this.teardown();
  }

  async onDeleted(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    if (this.client) {
      await this.client.disconnect().catch((err: Error) => this.error(err));
      this.client = null;
    }
  }

};
