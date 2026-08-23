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
- An MQTT broker both your hub and Homey can reach - easiest is the free
  "MQTT Broker" community app by Menno van Grinsven
  (https://homey.app/a/nl.scanno.mqttbroker/), or Mosquitto on a NAS / Raspberry Pi.

## Setup

1. Run an MQTT broker. Easiest: install the "MQTT Broker" app by Menno van
   Grinsven (https://homey.app/a/nl.scanno.mqttbroker/) on Homey
   (it listens on port 1883). In its settings, tick "Also allow unsecure
   connections" and create a Username & Password (needed even if "Disable user
   authentication" is on - the hub won't connect without one; enter the same ones
   on the device in step 4), then press "Start Broker" and confirm it shows
   "Broker is Running".
2. Point the SofaBaton app at it - hub settings -> MQTT / Home Assistant -> your
   broker's address and port.
3. Add the device in Homey - Devices -> + -> SofaBaton X2 -> SofaBaton Hub. Pick
   the auto-discovered "X2 HUB - ..." (the MAC fills in for you). Both the found
   hub and "SofaBaton X2 (manual setup)" start out ticked - un-tick the manual
   one so you don't also add an empty second device.
4. Open the device Settings - the broker address defaults to your Homey's IP.
   Set the port to match your broker, enter the same username & password you
   created in step 1, and save. The device connects.
5. Tap "Refresh devicelist" on the device card to load your devices and keys.

Full step-by-step guide (with pictures):
https://repairguydk.github.io/com.repairguydk.sofabatonx2/

## Tips

- Names showing as "Device N / Key N"? The hub's list query can be asleep -
  power-cycle the hub (unplug ~10 s), wait a minute, then tap "Refresh
  devicelist" again.
- Editing devices in the SofaBaton phone app while Homey is connected can be
  slow (the hub allows one client at a time). Tap "Pause hub connection" on the
  device to release the hub, then tap it again to reconnect.
- The hub is a small, modestly-powered device. After a lot of tinkering it can
  get overwhelmed and stop responding - a hard reboot (unplug ~10 s, wait a
  minute) almost always fixes it.
- Only buttons mapped to the SofaBaton "MQTT" device reach Homey.

## Support

Questions or bugs? repairguydk@gmail.com

--

Made with Danish temper and Spanish red wine by RepairGuyDK.
