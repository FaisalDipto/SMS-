# SMSWeb Android Gateway

This Kotlin Android app is the phone-side gateway described in the root README.

The phone receives `REQ|...` SMS messages, validates their format, queues them, and forwards them to the Raspberry Pi at the configured local hotspot URL. Responses from `POST /sms/incoming` are queued for SMS delivery back to the original sender.

## Setup

1. Open `android-bridge/` in Android Studio.
2. Connect an Android phone with an active SIM card.
3. Grant SMS permissions when the app starts.
4. Set the Raspberry Pi URL, for example `http://192.168.43.1:8080`.
5. Confirm the app shows **Pi connected** while the Go service is running.

The app uses cleartext HTTP because the Pi endpoint is on the private hotspot network. Do not expose this endpoint directly to the public internet.

The current workspace does not have Java, Gradle, or an Android SDK installed, so Android compilation must be performed from Android Studio or another machine with the Android toolchain.
