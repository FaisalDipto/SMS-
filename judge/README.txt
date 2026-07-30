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
- an Android gateway phone with the SMSWeb APK and active SIM;
- a second phone to send requests;
- the Go service on a computer or Raspberry Pi on the gateway hotspot;
- the same 16+ character authentication key on the service and gateway.

Safety limitation
This prototype is not an emergency-service deployment. Real operation requires
an authorized data source, audited shelter records, verified road data,
operational monitoring, field testing, and a maintained deployment process.
