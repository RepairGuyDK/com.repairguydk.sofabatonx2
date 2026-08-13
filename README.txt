SofaBaton X2 for Homey
======================

Control your SofaBaton X2 hub from Homey over MQTT: switch activities, press
remote keys, run macros and favorites, and use everything in Homey Flows.

How it works
------------
The X2 hub talks to an MQTT broker (the same integration SofaBaton built for
Home Assistant). This app is an MQTT client on that same broker. Both the hub
and Homey must be able to reach the broker on your LAN.

    SofaBaton X2 hub  <-- MQTT -->  broker  <-- MQTT -->  Homey (this app)

Setup
-----
1. Run an MQTT broker on your network. Easiest: install the free "MQTT Broker"
   community app on Homey (app id nl.scanno.mqttbroker). It listens on port 1883.
   Any other broker (Mosquitto on a NAS/Pi, etc.) works too.

2. In the SofaBaton phone app, open your hub's settings and enable the MQTT /
   Home Assistant option. Enter the broker's IP address, port (1883) and, if the
   broker requires it, username and password. Note the hub's MAC address shown
   in the app.

3. In Homey, add the "SofaBaton Hub" device. In the pairing screen enter the
   broker address, port, the hub MAC address, and broker username/password if
   used. The app tests the connection and lists the activities it finds.

Flow cards
----------
Triggers:  The activity changed | A specific activity started | Everything turned off
Condition: Current activity is / is not <activity>
Actions:   Start activity | Turn everything off | Press a remote key |
           Run a macro | Send a favorite

Notes
-----
- Standard remote keys (play, volume, arrows, ...) are sent in the context of
  the currently running activity, so start an activity first.
- Macros and favorites are defined per activity in the SofaBaton app.

Development
-----------
    npm install
    homey app validate --level publish
    homey app run          # live-run on your Homey for testing

The legacy reverse-engineered TCP transport (superseded by MQTT) is kept in
_legacy/ for reference and is excluded from the build.
