# SMSWeb Android Gateway

This Kotlin Android app supports two roles:

- **User phone** sends SMSWeb requests, receives signed responses, verifies
  them, and renders the offline dashboard and map.
- **SMS gateway phone** receives public requests, forwards them to the local Pi
  service, and sends signed response SMS messages back.

The phone receives `REQ|...` SMS messages, validates their format, queues them, and forwards them to the Raspberry Pi at the configured local hotspot URL. Responses from `POST /sms/incoming` are queued for SMS delivery back to the original sender. The app also packages the local SMSWeb PWA so the phone can display Home, Shelters, Alerts, and Map views offline.

## Setup

1. Open `android-bridge/` in Android Studio.
2. Connect an Android phone with an active SIM card.
3. Grant SMS permissions when the app starts.
4. Select **User phone** or **SMS gateway phone** under **This phone's role**.
5. Start the Go service with `SMSWEB_AUTH_KEY` set to a private value containing
   at least 16 characters.
6. Open the device setup panel, enter that exact value under
   **Shared response authentication key**, and tap **Provision authentication
   key**. The controls then lock and collapse; ordinary users see only the
   **Protected** security status. The value is not displayed again.
7. In Gateway mode, set the Raspberry Pi URL, for example `http://192.168.43.1:8080`, and tap
   **Save URL**.
8. Tap **Check connection** while the Go service is running.
9. On both phones, enter the gateway phone's SIM number and tap **Save number**.
10. On the User phone, tap **Request shelters** to send a `REQ|1|...|SHELTER|DHK` SMS.
11. Tap **Request alerts** or **Request hazards** for the other signed data pages.
12. On the Map page, grant location permission, then calculate a route. Current
    authenticated hazards are excluded from the local route graph.
13. Open **Activity** to inspect receive, forward, authentication, handoff,
    rejection, and retry events. **Retry queued gateway messages** triggers an
    immediate store-and-forward retry.
14. Confirm the gateway shows **Connected** and the user phone renders the
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

User mode requires the configured response key in this hackathon build so it
can verify the compact HMAC tag. Do not distribute that design publicly.
Production user clients should verify asymmetric signatures with a bundled
public key instead.

The **Authority operations console** is for a deployment operator, not an
ordinary SMS requester. It can update shelters, alerts, and hazards through the
native bridge. Android adds the app-private shared key to the local HTTP
request; the WebView never reads the key. The Go service validates each update
and records it in the audit log.

The app uses cleartext HTTP because the Pi endpoint is on the private hotspot network. Do not expose this endpoint directly to the public internet.

Android compilation uses Android Studio's bundled JDK and the Gradle wrapper.
The project can be run from Android Studio or built from a terminal after
`JAVA_HOME` points to Android Studio's `jbr` directory.
