SMSWeb Judge Demo
=================

Windows quick start
1. Double-click "Start SMSWeb Demo.cmd".
2. Wait for the browser to open at http://127.0.0.1:8080.
3. Select "Run 60-second demo".
4. On the map, select "Find route to nearest open shelter".

The quick-start scenario is explicitly marked as demonstration data. It runs
entirely on this computer and does not require internet access, Android Studio,
an SMS plan, or a Raspberry Pi.

Real two-phone demonstration
See the root README.md in the source repository. It requires:
- SMSWeb-Gateway-debug.apk on an Android gateway phone with an active SIM;
- SMSWeb-User-debug.apk on a second Android phone;
- the Go service on a computer or Raspberry Pi on the gateway hotspot;
- demo key "smsweb-local-judge-demo-key" on the service and gateway.

The User APK is preconfigured for gateway number +8801701485658 and does not
ask judges to select a role, enter a phone number, or type an authentication
key. If a different gateway SIM is used, rebuild the User APK with the
SMSWEB_USER_SERVICE_NUMBER Gradle property described in android-bridge/README.md.

User APK quick look
Install SMSWeb-User-debug.apk and grant SMS/location permissions. It opens
directly on an interactive offline Greater Dhaka basemap with no preloaded
emergency records. Tap Shelters, Alerts, and Hazards to demonstrate the real
SMS request/response flow. The service's demo records appear only after the
User phone receives and authenticates the gateway response.

Safety limitation
This prototype is not an emergency-service deployment. Real operation requires
an authorized data source, audited shelter records, verified road data,
operational monitoring, field testing, and a maintained deployment process.
