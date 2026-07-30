# SMSWeb Android Gateway

This Kotlin Android app is the phone-side gateway and mobile dashboard described in the root README.

The phone receives `REQ|...` SMS messages, validates their format, queues them, and forwards them to the Raspberry Pi at the configured local hotspot URL. Responses from `POST /sms/incoming` are queued for SMS delivery back to the original sender. The app also packages the local SMSWeb PWA so the phone can display Home, Shelters, Alerts, and Map views offline.

## Setup

1. Open `android-bridge/` in Android Studio.
2. Connect an Android phone with an active SIM card.
3. Grant SMS permissions when the app starts.
4. In the dashboard, set the Raspberry Pi URL, for example `http://192.168.43.1:8080`, and tap **Save URL**.
5. Tap **Check connection** while the Go service is running.
6. For an outbound request demo, enter the gateway SMS number and tap **Save number**.
7. Tap **Request shelters** to create and send a `REQ|1|...|SHELTER|DHK` SMS.
8. Tap **Request alerts** to create and send a `REQ|1|...|ALERT|DHK` SMS.
9. On the Map page, grant location permission when prompted to calculate straight-line shelter distances.
10. Confirm the SMSWeb dashboard opens in the app and shows **Connected**.

The WebView package includes the offline dashboard shell and a native bridge for saving the Pi URL, checking the local `/health` endpoint, and rendering structured responses received from the Pi. Responses are retained in the native queue until the dashboard confirms that they were stored offline, so closing the app does not lose information.

Long responses use two levels of protection. The Go service returns numbered
protocol messages, Android queues each one, and `SmsManager` handles any
additional carrier-level segmentation. The offline dashboard persists numbered
parts in IndexedDB, reassembles out-of-order delivery, ignores duplicates, and
waits up to ten minutes for missing parts before discarding an incomplete
assembly.

The app uses cleartext HTTP because the Pi endpoint is on the private hotspot network. Do not expose this endpoint directly to the public internet.

Android compilation uses Android Studio's bundled JDK and the Gradle wrapper.
The project can be run from Android Studio or built from a terminal after
`JAVA_HOME` points to Android Studio's `jbr` directory.
