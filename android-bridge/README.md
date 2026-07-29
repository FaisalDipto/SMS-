# SMSWeb Android Gateway

This Kotlin Android app is the phone-side gateway and mobile dashboard described in the root README.

The phone receives `REQ|...` SMS messages, validates their format, queues them, and forwards them to the Raspberry Pi at the configured local hotspot URL. Responses from `POST /sms/incoming` are queued for SMS delivery back to the original sender. The app also packages the local SMSWeb PWA so the phone can display Home, Shelters, Alerts, and Map views offline.

## Setup

1. Open `android-bridge/` in Android Studio.
2. Connect an Android phone with an active SIM card.
3. Grant SMS permissions when the app starts.
4. Set the Raspberry Pi URL, for example `http://192.168.43.1:8080`.
5. Confirm the SMSWeb dashboard opens in the app.

The current WebView package includes the offline dashboard shell. Its native request/response bridge will be connected to the Pi service in the next milestone.

The app uses cleartext HTTP because the Pi endpoint is on the private hotspot network. Do not expose this endpoint directly to the public internet.

The current workspace does not have Java, Gradle, or an Android SDK installed, so Android compilation must be performed from Android Studio or another machine with the Android toolchain.
