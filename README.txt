# SofaBaton X2 for Homey

Bring your SofaBaton X2 universal remote into Homey over MQTT. Control your
devices from Homey Flows, and use the remote's buttons to trigger Homey Flows.

## What it does

- Homey -> SofaBaton: a Flow action, "On [device]: press [key]", sends commands
  to any device in your SofaBaton (TV, aircon, fan, projector, ...).
- SofaBaton -> Homey: Flow triggers fire when you press an MQTT-mapped button on
  the remote, so a button press can run anything in Homey.
- Devices and keys appear as friendly dropdowns - no raw JSON. New MQTT buttons
  appear the first time you press them.
- The hub is auto-discovered over mDNS and the settings are pre-filled for you.

## Requirements

- A Homey Pro (runs local apps).
- A SofaBaton X2 hub with MQTT / Home Assistant enabled in the SofaBaton app.
- An MQTT broker both your hub and Homey can reach - e.g. the free "MQTT Broker"
  community app on Homey, or Mosquitto on a NAS / Raspberry Pi.

## Setup

1. Run an MQTT broker. Easiest: install the "MQTT Broker" app on Homey
   (it listens on port 1883).
2. Point the SofaBaton app at it - hub settings -> MQTT / Home Assistant -> your
   broker's address and port.
3. Add the device in Homey - Devices -> + -> SofaBaton X2 -> SofaBaton Hub. Pick
   the auto-discovered "X2 HUB - ..." (the MAC fills in for you).
4. Open the device Settings - the broker address defaults to your Homey's IP.
   Set the port to match your broker and save. The device connects.
5. Tap "Refresh devicelist" on the device card to load your devices and keys.

Full step-by-step guide (with pictures):
https://repairguydk.github.io/com.repairguydk.sofabatonx2/

## Tips

- Names showing as "Device N / Key N"? The hub's list query can be asleep -
  power-cycle the hub (unplug ~10 s), wait a minute, then tap "Refresh
  devicelist" again.
- Editing devices in the SofaBaton phone app while Homey is connected can be
  slow (the hub allows one client at a time). Turn on "Pause" in the device
  settings to release the hub, then turn it off again.
- Only buttons mapped to the SofaBaton "MQTT" device reach Homey.

## Support

Questions or bugs? repairguydk@gmail.com
