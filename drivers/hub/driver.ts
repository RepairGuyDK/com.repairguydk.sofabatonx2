'use strict';

import Homey from 'homey';
import { SofaBatonMqtt, KeyEvent } from '../../lib/sofabaton-mqtt';

interface HubDeviceLike extends Homey.Device {
  getClient(): SofaBatonMqtt;
}

interface AutocompleteItem {
  id: string;
  name: string;
}

module.exports = class HubDriver extends Homey.Driver {

  private buttonPressedTrigger!: Homey.FlowCardTrigger;

  private anyButtonPressedTrigger!: Homey.FlowCardTrigger;

  async onInit(): Promise<void> {
    this.registerTriggers();
    this.registerActions();
  }

  // --- Triggers ---

  private registerTriggers(): void {
    this.buttonPressedTrigger = this.homey.flow.getTriggerCard('button_pressed');
    this.buttonPressedTrigger.registerRunListener(
      async (
        args: { sb_device?: AutocompleteItem; key?: AutocompleteItem },
        state: { deviceId: number; keyId: number },
      ) =>
        !!args.sb_device
        && !!args.key
        && Number(args.sb_device.id) === Number(state.deviceId)
        && Number(args.key.id) === Number(state.keyId),
    );
    this.buttonPressedTrigger
      .getArgument('sb_device')
      .registerAutocompleteListener((query: string, args: { device?: HubDeviceLike }) =>
        this.deviceAutocomplete(query, args));
    this.buttonPressedTrigger
      .getArgument('key')
      .registerAutocompleteListener((query: string, args: { device?: HubDeviceLike; sb_device?: AutocompleteItem }) =>
        this.keyAutocomplete(query, args));

    this.anyButtonPressedTrigger = this.homey.flow.getTriggerCard('any_button_pressed');
  }

  triggerButtonPressed(device: Homey.Device, event: KeyEvent): void {
    const tokens = {
      device_name: event.deviceName,
      key_name: event.keyName,
      device_id: event.deviceId,
      key_id: event.keyId,
    };
    const state = { deviceId: event.deviceId, keyId: event.keyId };
    this.buttonPressedTrigger.trigger(tokens, state).catch((err: Error) => this.error(err));
  }

  triggerAnyButtonPressed(device: Homey.Device, event: KeyEvent): void {
    const tokens = {
      device_name: event.deviceName,
      key_name: event.keyName,
      device_id: event.deviceId,
      key_id: event.keyId,
    };
    this.anyButtonPressedTrigger.trigger(tokens).catch((err: Error) => this.error(err));
  }

  // --- Actions ---

  private registerActions(): void {
    const pressKey = this.homey.flow.getActionCard('press_key');
    pressKey.registerRunListener(
      async (args: { device: HubDeviceLike; sb_device: AutocompleteItem; key: AutocompleteItem }) => {
        await args.device.getClient().sendKey(Number(args.sb_device.id), Number(args.key.id));
      },
    );
    pressKey
      .getArgument('sb_device')
      .registerAutocompleteListener((query: string, args: { device?: HubDeviceLike }) =>
        this.deviceAutocomplete(query, args));
    pressKey
      .getArgument('key')
      .registerAutocompleteListener((query: string, args: { device?: HubDeviceLike; sb_device?: AutocompleteItem }) =>
        this.keyAutocomplete(query, args));
  }

  // --- Autocomplete helpers ---

  private resolveDevice(args: { device?: HubDeviceLike }): HubDeviceLike | null {
    // In run-listeners args.device is a live Device instance; in autocomplete
    // listeners it is only a plain reference (no getClient), so fall back to a
    // real driver device instance.
    if (args.device && typeof args.device.getClient === 'function') {
      return args.device;
    }
    const devices = this.getDevices() as HubDeviceLike[];
    return devices.length > 0 ? devices[0] : null;
  }

  private async deviceAutocomplete(
    query: string,
    args: { device?: HubDeviceLike },
  ): Promise<AutocompleteItem[]> {
    try {
      const device = this.resolveDevice(args);
      if (!device) {
        return [];
      }
      const client = device.getClient();
      let list = client.getDevices();
      if (list.length === 0) {
        // Only reach out to the hub when we have nothing cached (gentle).
        list = await client.fetchDevices();
      }
      const all = list.map((d) => ({ id: String(d.id), name: d.name }));
      return HubDriver.filterAutocomplete(all, query);
    } catch (err) {
      this.error(`deviceAutocomplete: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  /**
   * Filter autocomplete items by query, but return the FULL list when the query
   * is empty or exactly matches an item name. Homey pre-fills the search box
   * with the current selection, and without this the list would be "locked" to
   * that one item so you couldn't pick a different one.
   */
  private static filterAutocomplete(
    items: AutocompleteItem[],
    query: string,
  ): AutocompleteItem[] {
    const needle = query.trim().toLowerCase();
    if (needle === '' || items.some((i) => i.name.toLowerCase() === needle)) {
      return items;
    }
    return items.filter((i) => i.name.toLowerCase().includes(needle));
  }

  private async keyAutocomplete(
    query: string,
    args: { device?: HubDeviceLike; sb_device?: AutocompleteItem },
  ): Promise<AutocompleteItem[]> {
    try {
      const device = this.resolveDevice(args);
      if (!device || !args.sb_device) {
        return [];
      }
      const deviceId = Number(args.sb_device.id);
      const client = device.getClient();
      let keys = client.getDeviceKeys(deviceId);
      if (keys.length === 0) {
        keys = await client.fetchDeviceKeys(deviceId);
      }
      const all = keys.map((k) => ({ id: String(k.id), name: k.name }));
      return HubDriver.filterAutocomplete(all, query);
    } catch (err) {
      this.error(`keyAutocomplete: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  // --- Pairing ---

  // Broker/MAC details are entered in the device's settings page (pre-filled
  // with sensible defaults), so pairing just creates the single hub device.
  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    session.setHandler('list_devices', async () => [
      {
        name: 'SofaBaton X2',
        data: { id: 'sofabaton-hub' },
      },
    ]);
  }

};
