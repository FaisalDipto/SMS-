# SMSWeb Android Apps

The Android project produces two purpose-built APKs:

- **SMSWeb User** is a map-first resident app. It sends requests, receives
  signed responses, and renders shelters, alerts, hazards, routes, and update
  activity offline. Its role, gateway number, and controlled-demo verification
  profile are selected at build time.
- **SMSWeb Gateway** receives public requests, forwards them to the local Pi
  service, and sends signed response SMS messages back.

The Gateway phone receives `REQ|...` SMS messages, validates their format,
queues them, and forwards them to the Raspberry Pi at the configured local
hotspot URL. Responses from `POST /sms/incoming` are queued for SMS delivery
back to the original sender. Both apps package the offline SMSWeb interface.

## Build both APKs

1. Open `android-bridge/` in Android Studio.
2. Select **Build > Assemble Project**, or run:

   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app:assembleGatewayDebug :app:assembleUserDebug
   ```

3. Install `app-gateway-debug.apk` from
   `app/build/outputs/apk/gateway/debug/` on the gateway phone.
4. Install `app-user-debug.apk` from
   `app/build/outputs/apk/user/debug/` on the resident/test phone.

The User build currently targets gateway number `+8801701485658`. Override it
without adding a settings screen:

```powershell
.\gradlew.bat :app:assembleUserDebug `
  -PSMSWEB_USER_SERVICE_NUMBER="+8801XXXXXXXXX"
```

## Gateway setup

1. Connect the Gateway phone to the Pi/computer hotspot.
2. Grant SMS permissions when the app starts.
3. Start the Go service with `SMSWEB_AUTH_KEY` set to the controlled demo key
   `smsweb-local-judge-demo-key`.
4. Open the device setup panel, enter that exact value under
   **Shared response authentication key**, and tap **Provision authentication
   key**.
5. Set the Raspberry Pi URL, for example `http://192.168.43.1:8080`, and tap
   **Save URL**.
6. Tap **Check connection** while the Go service is running.
7. Save the gateway phone's own SMS number.

## User setup

1. Install the User APK.
2. Grant SMS and location permissions.
3. The map-first home screen shows the bundled Greater Dhaka basemap but starts
   without emergency records.
4. Tap **Shelters**, **Alerts**, or **Hazards** in the update panel to request
   current information. There is no role, number, Pi URL, or
   authentication-key setup on this edition.
5. Wait for the response SMS to populate the relevant screen. On the Map page,
   grant location permission, then select **Show fastest safe route**. Current
   authenticated hazards are excluded from the local route graph.
6. Open **Updates** to inspect receive and authentication events.

The Go service's `-demo` records are not packaged into the User APK. They must
travel through the gateway and SMS response path, which makes the end-to-end
demo visible and auditable.

On the Gateway edition, **Activity** also shows forward, handoff,
    rejection, and retry events. **Retry queued gateway messages** triggers an
    immediate store-and-forward retry.
Confirm the gateway shows **Connected** and the user phone renders the
    response without opening its ordinary SMS application.

The WebView package includes the offline dashboard shell and a native bridge for saving the Pi URL, checking the local `/health` endpoint, and rendering structured responses received from the Pi. Responses are retained in the native queue until the dashboard confirms that they were stored offline, so closing the app does not lose information.

Long responses use two levels of protection. The Go service returns numbered
protocol messages, Android queues each one, and `SmsManager` handles any
additional carrier-level segmentation. The offline dashboard persists numbered
parts in IndexedDB, reassembles out-of-order delivery, ignores duplicates, and
waits up to ten minutes for missing parts before discarding an incomplete
assembly.

Pi responses are authenticated before they cross into the WebView or SMS
outbox. Missing keys, invalid tags, expired records, future timestamps, and
replayed tags are rejected by the native Android layer. The shared key is
stored in app-private preferences and is not exposed through a JavaScript
getter.

The User APK contains the fixed controlled-demo HMAC profile so judges do not
have to type a key. That improves demo onboarding but is intentionally not a
production trust design: a public client secret can be extracted and reused to
forge messages. Do not publish this build as a real emergency client.
Production user clients must verify asymmetric signatures with a bundled public
key while the private signing key remains only with the authority service.

The **Authority operations console** is for a deployment operator, not an
ordinary SMS requester. It can update shelters, alerts, and hazards through the
native bridge. Android adds the app-private shared key to the local HTTP
request; the WebView never reads the key. The Go service validates each update
and records it in the audit log.

The app uses cleartext HTTP because the Pi endpoint is on the private hotspot network. Do not expose this endpoint directly to the public internet.

Android compilation uses Android Studio's bundled JDK and the Gradle wrapper.
The project can be run from Android Studio or built from a terminal after
`JAVA_HOME` points to Android Studio's `jbr` directory.
