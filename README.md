# SofaBaton X2 for Homey

Connect your **SofaBaton X2** universal remote to Homey over MQTT. Control your
SofaBaton devices from Homey Flows, and use the remote's MQTT buttons to trigger
Homey Flows.

## What it does

- **Homey → SofaBaton** — a Flow action *"On [device]: press [key]"* sends
  commands to any device configured in your SofaBaton (TV, aircon, fan, …).
- **SofaBaton → Homey** — Flow triggers *"A specific button was pressed"* and
  *"Any button was pressed"* fire when you press an MQTT-mapped button on the
  remote, so a button press can run anything in Homey.
- Devices and keys are read from the hub and shown as friendly dropdowns — no
  raw JSON to hand-match. New MQTT buttons appear automatically the first time
  you press them.

## Requirements

- A **Homey Pro** (runs local community apps).
- A **SofaBaton X2** hub with the MQTT / Home Assistant integration enabled in
  the SofaBaton app.
- An **MQTT broker** that both your SofaBaton hub and Homey can reach on the LAN
  (e.g. the free "MQTT Broker" community app on Homey, or Mosquitto on a
  NAS/Raspberry Pi).

## Setup

1. Run an MQTT broker on your network and point the SofaBaton app's MQTT
   settings at it (note the broker address, port and the hub's MAC address).
2. In Homey, add the **SofaBaton Hub** device.
3. Open the device's **Settings** and enter the broker address, port, the hub
   **MAC address**, and username/password if your broker uses them.
4. Build your Flows using the SofaBaton trigger and action cards.

## Notes

- The hub's device/key list query can be slow to respond. The app caches the
  list, so day-to-day use never depends on it. Use the **Refresh devicelist**
  button on the device card after adding/removing devices in the SofaBaton app.
- Some hubs allow only one active client. If the SofaBaton phone app becomes
  slow while Homey is connected, enable **Pause** in the device settings to
  release the hub, then disable it again when you're done.

## License

MIT
