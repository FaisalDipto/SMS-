# SMSWeb

## An Offline Website Generated from SMS Responses

SMSWeb is an offline-first web interface that uses SMS as its data transport. Instead of sending an HTTP request to a traditional web server and waiting for an HTML response, the user sends a compact SMS command. A structured SMS response is received by the phone, decoded locally, stored offline, and rendered as a web page.

The system is designed for situations where mobile data or Wi-Fi internet is unavailable but cellular SMS is still working.

> Important limitation: a normal browser cannot read incoming SMS directly. A small Android companion application is required to read SMS and pass the content to the local web interface. The website itself can still be written with ordinary HTML, CSS, and JavaScript.

## Quick Judge Demo

The packaged Windows demo proves the parser, storage, trust labels, hazard layer,
and route calculation without requiring Android Studio or two SIM cards.

1. Extract `dist/SMSWeb-Judge-Demo.zip`.
2. Double-click `Start SMSWeb Demo.cmd`.
3. Wait for `http://127.0.0.1:8080` to open.
4. Select **Run 60-second demo**.
5. On **Map**, select **Find route to nearest open shelter**.
6. Inspect **Hazards** and **Activity** to explain why the selected route is trusted
   and which local records produced it.

The banner and records explicitly say **demo**. This path is for judging and
training; it does not pretend the bundled shelter records came from an emergency
authority.

To rebuild the judge package after changing the source:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-judge-package.ps1 -IncludeApk
```

## 1. Project Goals

SMSWeb should:

- Show useful crisis information without internet access.
- Use SMS instead of HTTP for requests and responses.
- Render pages locally on the user's device.
- Continue working with previously received data when SMS is temporarily unavailable.
- Use short messages because SMS has a limited character count.
- Support emergency information such as shelters, medical supplies, road warnings, and missing-person reports.
- Keep the user interface simple enough to use during stress.
- Allow the same protocol to work with a real SMS gateway or a development simulator.

## 2. Example User Experience

The user opens the SMSWeb application and selects **Find shelters**.

The application sends this SMS:

```text
REQ|1|A17K|SHELTER|DHK
```

The crisis information service replies:

```text
RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL
```

The Android bridge receives the SMS and passes it to the local web application. The web application renders:

```text
Emergency Shelters - Dhaka

Mirpur       120 spaces   Open
Uttara        80 spaces   Open
Dhaka Univ.    0 spaces   Full
```

No webpage was downloaded from the internet. The page was generated from the SMS response using the local application code.

## 3. High-Level Architecture

```text
                         Cellular SMS network
                                  |
       +--------------------------+--------------------------+
       |                                                     |
   User phone                                    Raspberry Pi Go service
       |                                                     |
       | SMS request                                         |
       +---------------------> SMS receiver                 |
       |                                                     |
       | SMS response                                        |
       <--------------------- SMS response                   |
       |
       v
+-------------------+
| Android Phone SMS Gateway |
| - reads SMS               |
| - validates sender        |
| - forwards payload        |
+---------+---------+
          |
          | local HTTP API / Wi-Fi hotspot
          v
+-------------------+
| SMSWeb PWA         |
| - protocol parser  |
| - IndexedDB cache  |
| - page renderer    |
| - navigation       |
+---------+---------+
          |
          v
   Offline HTML UI
```

### Main components

#### 3.1 SMSWeb PWA

The Progressive Web App is the user interface. It contains all JavaScript, CSS, icons, and page templates locally. A service worker caches these files so the application shell can open without internet access.

Responsibilities:

- Display the home screen and cached information.
- Create SMS request payloads.
- Parse structured SMS responses.
- Store data in IndexedDB.
- Render HTML cards, lists, forms, and alerts.
- Track message status and expiry times.
- Provide a simulator mode for development.

#### 3.2 Android Phone SMS Gateway

No GSM module is required. The Android phone with a SIM performs the SMS gateway role.

Responsibilities:

- Receive incoming SMS messages.
- Validate the sender and message format.
- Forward SMS payloads to the Raspberry Pi over the local hotspot network.
- Receive responses from the Raspberry Pi.
- Send response SMS messages back to users.
- Queue messages if the Raspberry Pi is temporarily unavailable.

The Android phone should run a Kotlin companion application. The app communicates with the Pi through a local HTTP API, such as:

```text
http://raspberry-pi-local-ip:8080/sms/incoming
```

For multiple users, use a dedicated Android phone as the gateway so it can remain powered, connected to the Pi, and available to receive SMS messages.

#### 3.3 Raspberry Pi Crisis Service

The Raspberry Pi runs the Go crisis service and SQLite database.

The Android gateway sends SMS data to it over the local Wi-Fi hotspot.

Responsibilities:

- Parse incoming SMS requests.
- Store messages in SQLite.
- Process requests concurrently using a queue and worker pool.
- Generate compact SMS responses.
- Return responses to the Android gateway.
- Manage shelters, alerts, roads, and medical resources.
- Serve the offline administrator dashboard.

The real outage architecture is:

```text
User SMS
  ↓
Android phone with SIM
  ↓ Local hotspot
Raspberry Pi Go service
  ↓ Local hotspot
Android phone
  ↓ SMS
User
```

Cloud SMS providers may be used for development, but they require internet access at the backend and are not suitable as the only gateway during a complete internet outage.

### 3.4 Network topology during an outage

The Android phone creates a local Wi-Fi hotspot. The Raspberry Pi connects to that hotspot. This local connection does not require internet access.

```text
Android phone hotspot
       │
       ├── Raspberry Pi
       └── Administrator laptop
```

Cellular SMS remains separate from the local Wi-Fi network.

SMS uses the cellular network, while communication between the phone and Pi uses the local hotspot.

## 4. Offline Data Flow

### Request flow

```text
1. User selects an action.
2. PWA creates a request payload.
3. Android bridge sends the payload as SMS.
4. Crisis service processes the command.
5. Crisis service sends a response SMS.
6. Android bridge receives the response.
7. PWA validates and parses the response.
8. PWA stores the data in IndexedDB.
9. PWA renders the page locally.
```

### Offline fallback flow

If SMS is unavailable:

```text
1. PWA opens from the service-worker cache.
2. Previously received pages are loaded from IndexedDB.
3. The user sees the last known update time.
4. Expired or uncertain information is clearly marked.
5. Pending requests remain queued for later transmission.
```

The application must never present old information as current.

### SMS gateway flow

```text
1. User sends SMS to the Android gateway phone number.
2. Android app receives the SMS.
3. Android app validates the sender and message format.
4. Android app sends the payload to the Pi over local HTTP.
5. Go service processes the request and stores it in SQLite.
6. Go service creates a response.
7. Android app receives the response from the Pi.
8. Android app sends the response back to the user by SMS.
```

## 5. SMS Protocol Design

SMS is short and expensive compared with a normal HTTP request, so the protocol should use compact fields rather than large JSON documents.

### 5.1 Request format

```text
REQ|VERSION|REQUEST_ID|COMMAND|ARGUMENTS
```

Example:

```text
REQ|1|A17K|SHELTER|DHK
```

Available commands for the first version:

| Command | Purpose | Example |
|---|---|---|
| `HOME` | Load the main menu | `REQ|1|A17K|HOME|-` |
| `SHELTER` | Find available shelters | `REQ|1|A17K|SHELTER|DHK` |
| `MED` | Find medical resources | `REQ|1|A17K|MED|DHK` |
| `ROAD` | Get road warnings | `REQ|1|A17K|ROAD|DHK` |
| `REPORT` | Submit a report | `REQ|1|A17K|REPORT|ROAD,BLOCKED,MIRPUR` |
| `HELP` | Show command help | `REQ|1|A17K|HELP|-` |
| `ALERT` | Retrieve active emergency alerts | `REQ|1|A17K|ALERT|DHK` |

### 5.2 Response format

```text
RES|VERSION|REQUEST_ID|PAGE|PART/TOTAL|REGION|TRUST|SOURCE|VERIFIED_AT|EXPIRES_AT|PAYLOAD
```

Example:

```text
RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL
```

`TRUST` is `VERIFIED`, `DEMO`, or `UNVERIFIED`. `SOURCE` is the compact
identifier of the organization or dataset responsible for the information.
`VERIFIED_AT` and `EXPIRES_AT` are Unix timestamps in seconds, and expiry must
be later than verification. `DEMO` records must never be presented as
authority-verified. The client can still display the older seven-field response
format, but treats it as unverified and does not enable routing without a
current expiry.

### 5.3 Alert format

```text
ALT|VERSION|REQUEST_ID|ALERT_ID|PRIORITY|EXPIRES|REGION|MESSAGE
```

Example:

```text
ALT|1|A17K|F22P|HIGH|1764000000|DHK|Avoid road near Mirpur bridge
```

### 5.4 Error format

```text
ERR|VERSION|REQUEST_ID|CODE|MESSAGE
```

Example:

```text
ERR|1|A17K|UNKNOWN_COMMAND|Use HELP for commands
```

### 5.5 Rules for the protocol

- Use a fixed delimiter and escape delimiter characters in user-entered text.
- Keep payloads below one SMS segment where possible.
- Split long responses into numbered parts such as `1/3`, `2/3`, and `3/3`.
- Include a request ID so delayed SMS responses can be matched correctly.
- Include timestamps or expiry times for information that changes.
- Reject responses from unknown senders.
- Add a checksum or signature in the production version.
- Never put full medical histories or passwords into plain SMS.

## 6. Local Web Application Design

### 6.1 Suggested project structure

```text
smsweb/
├── web/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── protocol.js
│   ├── storage.js
│   ├── renderer.js
│   ├── simulator.js
│   ├── sw.js
│   └── icons/
├── android-bridge/
│   └── Android Studio project
├── service/
│   ├── server.js
│   ├── commands.js
│   ├── protocol.js
│   └── data/
├── tests/
└── README.md
```

### 6.2 IndexedDB data model

The local database can contain the following stores:

```text
pages
  key: pageId
  fields: title, content, receivedAt, expiresAt, source

alerts
  key: alertId
  fields: priority, message, region, receivedAt, expiresAt

messages
  key: requestId
  fields: direction, rawText, status, createdAt

settings
  key: settingName
  fields: value
```

Use IndexedDB directly or a small wrapper such as Dexie.js. For a no-dependency prototype, use the native IndexedDB API.

### 6.3 Renderer behavior

The renderer should only create known UI components. It should not insert raw SMS text as unrestricted HTML.

Supported components:

- Page title
- Alert banner
- Information card
- List item
- Status badge
- Button/action
- Last updated label

All received text must be escaped before being inserted into the DOM.

## 7. Step-by-Step Build Process

### Step 1: Install prerequisites

Install:

- Node.js 20 or later, only if using the JavaScript simulator
- Git
- Android phone with an active SIM card
- Raspberry Pi
- Local Wi-Fi hotspot capability
- Android Studio
- Go
- SQLite

Verify Node.js:

```bash
node --version
npm --version
```

### Step 2: Create the project

```bash
mkdir smsweb
cd smsweb
mkdir web service tests
npm init -y
```

Create the initial web files:

```text
web/index.html
web/styles.css
web/app.js
web/protocol.js
web/storage.js
web/renderer.js
web/sw.js
```

### Step 3: Build the SMS protocol parser

Implement these functions first:

```javascript
parseRequest(text)
parseResponse(text)
parseAlert(text)
serializeRequest(request)
serializeResponse(response)
```

Example parsing logic:

```javascript
function parseResponse(text) {
  const parts = text.split('|');

  if (parts[0] !== 'RES' || parts.length < 7) {
    throw new Error('Invalid response');
  }

  return {
    type: parts[0],
    version: parts[1],
    requestId: parts[2],
    page: parts[3],
    part: parts[4],
    region: parts[5],
    payload: parts.slice(6).join('|')
  };
}
```

Add validation for version, request ID, allowed page names, and part numbers.

### Step 4: Add the local database

Store every valid response in IndexedDB. Store the raw message as well as the parsed result so that debugging and auditing are possible.

Required operations:

```javascript
saveMessage(message)
savePage(page)
getPage(pageId)
getActiveAlerts()
queueRequest(request)
```

### Step 5: Build the page renderer

Create a renderer that converts parsed records into safe HTML. Start with three pages:

1. Home page
2. Shelter page
3. Alerts page

Every page should show:

- Data title
- Information content
- Status or priority
- Last received time
- Expiry warning when applicable

### Step 6: Add the service worker

The service worker should cache the application shell:

```javascript
const CACHE_NAME = 'smsweb-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/protocol.js',
  '/storage.js',
  '/renderer.js'
];
```

Use a cache-first strategy for application files. Data should come from IndexedDB.

### Step 7: Add simulator mode

Before connecting real SMS, add a developer screen with a text box:

```text
Paste SMS response here
[Parse and render]
```

Test with:

```text
RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL
```

This allows the entire web application to be developed without a SIM card, SMS provider, or additional hardware.

### Step 8: Build the response service

Create a Go service on the Raspberry Pi.

Required endpoints:

```text
POST /sms/incoming
POST /sms/response
GET  /health
```

Example incoming request:

```json
{
  "sender": "+8801XXXXXXXXX",
  "text": "REQ|1|A17K|SHELTER|DHK"
}
```

Example response returned to the Android gateway:

```json
{
  "recipient": "+8801XXXXXXXXX",
  "text": "RES|1|A17K|SHELTER|1/2|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|DU:23.7271:90.3944:0:FULL",
  "messages": [
    "RES|1|A17K|SHELTER|1/2|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|DU:23.7271:90.3944:0:FULL",
    "RES|1|A17K|SHELTER|2/2|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:23.8069:90.3687:120:OPEN"
  ]
}
```

`text` retains the first message for simple gateway compatibility. Current
gateways must use the ordered `messages` array so every numbered response is
queued and delivered.

Example command flow:

```text
SHELTER + DHK
  -> query shelter records
  -> compact the records
  -> create RES response
  -> return response to SMS adapter
```

The current Go service uses SQLite and exposes authenticated administrator
updates for shelters, alerts, and hazards. The dashboard's
**Authority operations console** calls those endpoints through the native
Android bridge, so the shared key remains in app-private storage rather than
being returned to JavaScript. The desktop judge build accepts the key only in
memory for local operator testing.

### Step 9: Add the Android SMS bridge

Create an Android application that communicates with the Raspberry Pi using the Pi's local hotspot IP address.

The Android app should implement:

- Incoming SMS receiver
- Outgoing SMS sender
- Local HTTP client
- Message queue
- Retry handling
- Sender verification
- Duplicate request detection
- Gateway connection status indicator

The bridge must also:

1. Request SMS permissions.
2. Register an SMS receiver.
3. Filter messages by the configured service number.
4. Validate the message prefix: `RES`, `ALT`, or `ERR`.
5. Store received SMS locally.
6. Pass the message to the WebView or local application database.

For a prototype, the bridge can use a WebView containing the PWA. The native Android layer sends the SMS text to JavaScript through a JavaScript interface.

Conceptual bridge call:

```javascript
window.smsWeb.receiveSms(rawSmsText);
```

The PWA then parses and stores the message.

### Step 10: Add outgoing SMS support

The Android bridge should accept a serialized request from the PWA:

```javascript
window.smsWeb.sendSms('+8801000000000', 'REQ|1|A17K|SHELTER|DHK');
```

The Android layer uses the device's SMS service to send it.

### Step 11: Add multipart responses

If a response is longer than one SMS, split it into parts:

```text
RES|1|A17K|SHELTER|1/2|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:120:OPEN;UTTARA:80:OPEN
RES|1|A17K|SHELTER|2/2|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|DU:0:FULL;GULSHAN:40:OPEN
```

The PWA should:

- Store each part temporarily.
- Wait until all parts arrive.
- Reassemble them in order.
- Reject incomplete data after a timeout.

Current implementation:

- The Go service keeps shelter records intact and creates compact numbered
  protocol messages with a maximum 60-character payload per message.
- Android queues every protocol message separately and uses
  `SmsManager.divideMessage()` plus multipart transmission when the carrier
  still needs to segment one message.
- Incoming carrier segments from the same broadcast and sender are concatenated
  before request validation.
- The PWA stores numbered response parts in IndexedDB, accepts out-of-order
  delivery, ignores exact duplicate parts, rejects conflicting parts, and
  renders only after every part is present.
- Incomplete assemblies expire after ten minutes. Completed response IDs remain
  deduplicated for 24 hours.

### Step 12: Add security

Minimum security requirements:

- Accept messages only from known service numbers.
- Escape all SMS content before rendering.
- Add request IDs to stop replay confusion.
- Add a checksum for accidental corruption.
- Add digital signatures for high-risk alerts.
- Avoid storing unnecessary personal information.
- Encrypt sensitive local records where possible.
- Show whether a message is verified, unverified, or expired.

The system should never make dangerous decisions automatically. It should present information and its confidence level to the user.

Current prototype security implementation:

- The Go service refuses to start without `SMSWEB_AUTH_KEY` containing at least
  16 bytes.
- Every `RES`, `ALT`, and `ERR` message carries a 128-bit tag produced by
  HMAC-SHA256. The tag is intentionally compact enough to preserve the
  concatenated-SMS size target.
- The Android gateway verifies the tag in constant time, rejects expired or
  future-dated records, and blocks repeated authentication tags before a
  response can be stored, rendered, or sent by SMS.
- The shared key is stored in Android app-private preferences and is never
  returned to the WebView. It is provisioned once from the collapsed
  administrator setup panel; ordinary users see only the security status. The
  dashboard receives only the result `AUTHENTICATED` or a security rejection.
- Current-but-unauthenticated data remains non-routable. The developer
  simulator deliberately labels manually pasted content as unverified.

This symmetric key is appropriate for the hackathon prototype, but production
deployment should replace it with provisioned asymmetric signing keys,
rotation, revocation, and an audited authority update process.

## 8. Testing Plan

### Protocol tests

- Valid request parsing
- Invalid version
- Missing fields
- Unknown command
- Delimiter escaping
- Corrupted checksum
- Multipart ordering
- Duplicate messages

### Offline tests

- Open the PWA with internet disabled.
- Confirm cached pages still render.
- Confirm previously received alerts remain visible.
- Confirm expired alerts are marked clearly.
- Queue a request while SMS is unavailable.
- Deliver the queued response later.

### SMS tests

- Delayed response
- Duplicate response
- Response from an unknown number
- Long response split across multiple SMS messages
- Messages arriving out of order
- Unicode and Bangla text
- Incorrect or incomplete message

### User-experience tests

- Can a first-time user find shelter information in under 30 seconds?
- Are urgent alerts visually obvious?
- Can the interface be used with low literacy?
- Does it remain usable on a small screen?
- Is the last update time easy to see?

## 9. Demonstration Scenario

Use this scenario for the project presentation:

1. Start the PWA and load the application shell.
2. Load sample shelter data through simulator mode.
3. Disable the computer's internet connection.
4. Open the cached website again.
5. Show that previously received data still appears.
6. Enter a new request into the SMS simulator.
7. Feed the response SMS into the application.
8. Show the page being generated locally.
9. Send an expired alert and demonstrate that it is labelled as outdated.
10. Send two conflicting road reports and show both reports with confidence status.

## 10. Recommended Development Milestones

### Milestone 1: Local renderer

- Static PWA shell
- SMS text input
- Protocol parser
- Shelter page rendering

### Milestone 2: Offline storage

- Service worker
- IndexedDB
- Cached pages
- Expiry handling

### Milestone 3: SMS protocol

- Request serialization
- Response serialization
- Multipart messages
- Error handling

### Milestone 4: Android bridge

- Read incoming SMS
- Forward SMS to the PWA
- Send outgoing SMS

### Milestone 5: Crisis service

- Command processing
- SQLite or JSON data store
- Administrator update screen

### Milestone 6: Security and evaluation

- Sender verification
- Checksums or signatures
- Threat model
- Offline performance testing

## 11. Technology Choices

### Simplest prototype

- HTML, CSS, JavaScript
- IndexedDB
- Service worker
- Node.js simulator
- Android WebView bridge later

### More polished implementation

- React or Vue
- TypeScript
- Dexie.js for IndexedDB
- SQLite service
- Kotlin Android bridge
- Ed25519 message signatures

Avoid adding a large framework before the protocol and offline behavior work. The most important part of the project is the SMS-to-page pipeline.

## 12. What Makes This Project Different

SMSWeb is not just an SMS chatbot and not just an offline website. It combines both into a new delivery model:

```text
SMS command -> structured SMS response -> local parser -> generated webpage
```

The project demonstrates:

- A non-HTTP web transport
- Local-first application design
- Human-readable machine messages
- Delayed and unreliable communication handling
- Offline information expiry
- Crisis-oriented interface design

## 13. Final MVP Definition

The first complete version is finished when a user can:

1. Open the application without internet.
2. Choose **Find Shelters**.
3. Generate an SMS request.
4. Receive or paste a structured SMS response.
5. Have the response parsed automatically.
6. View a generated shelter webpage.
7. Close and reopen the application offline.
8. Still see the cached shelter data and its last update time.

This MVP is enough to demonstrate the core concept before adding a real Android SMS bridge or cellular gateway.

## 14. Offline Map Extension

SMSWeb can display shelter and hazard coordinates on a map even when internet access is unavailable. The map basemap and crisis data use separate storage paths:

```text
Offline map package: web/data/dhaka.pmtiles
SMS updates:         shelter coordinates stored in IndexedDB
Rendering:           MapLibre GL JS running locally
```

The bundled map is a 22.3 MB Protomaps vector extract containing 830 tiles from
zoom 0 through zoom 15. Its bounds are `90.30,23.65,90.50,23.95`, covering
greater Dhaka rather than only the Mirpur routing test area. The extract includes
roads, road names, buildings, land use, water, places, and points of interest
derived from OpenStreetMap. MapLibre, the PMTiles reader, style generator, fonts,
and sprites are all packaged under `web/vendor/`; displaying the map does not
depend on a CDN or live tile server.

Example SMS response:

```text
RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:23.8069:90.3687:120:OPEN;UTTARA:23.8759:90.4002:80:OPEN;DU:23.7271:90.3944:0:FULL
```

The parser validates trust, source, verification time, expiry, latitude,
longitude, and shelter status. A valid record is stored in IndexedDB and
rendered as a marker on the local map. Missing or expired freshness metadata
keeps the record visible with a warning but disables route calculation. The
marker and basemap require no internet request. The current `SMSWEB_DEMO`
records identify named areas, not verified shelter entrances; they are labelled
as demo data and must be replaced with authoritative shelter records before
emergency navigation is enabled.

The dashboard requests the phone's location, calculates paths to every reachable
open shelter on the bundled road graph, and ranks those shelters by mapped-road
distance. It does not use straight-line proximity to choose the destination.
Shelters outside the installed routing graph are reported as outside offline
coverage rather than being shown with a misleading distance.

The routing engine uses a separate local graph containing road nodes and directed edges. Each edge has a distance and can be marked blocked by an emergency report. The current demo bundles an expanded five-tile Mirpur graph generated from licensed OpenStreetMap data; it is still deliberately limited to that verified coverage area.

The current route preview bundles five adjacent OpenStreetMap road tiles covering a larger Mirpur area, including connector, residential, living-street, service, and other mapped road classes. It can calculate a road route only when both the phone location and the selected shelter fall inside that coverage. The UI must report when a location is outside coverage. The bundled road data includes OpenStreetMap attribution.

Route edges retain available OpenStreetMap road names, and the dashboard shows the phone's coordinate, destination shelter, named roads used by the selected route, and labels those named segments on the focused map. Unnamed road segments are reported honestly instead of being assigned invented street names.

The offline vector map supports touch zoom, panning, bearing rotation, compass
reset, a metric scale, shelter markers, a current-location marker, and the blue
calculated route. These controls change the view only; routable coverage still
depends on the verified road graph bundled for the region. Android loads the
bundled web app through `WebViewAssetLoader` so map assets use a secure local
HTTPS-style origin instead of the restricted `file://` origin. On Android,
location is requested through the native `LocationManager` bridge and passed to
the web map; browser geolocation remains the desktop/PWA fallback.

Current implementation:

- **MapLibre GL JS** for interactive vector-map rendering.
- **PMTiles** for packaging regional vector tiles into one offline archive.
- **IndexedDB** for shelters, hazards, and SMS reports.
- **Service Worker** for caching the application shell and map assets.

For a small proof of concept, Leaflet with a small local raster tile set is acceptable. Do not use `tile.openstreetmap.org` as an offline tile source; its policy prohibits bulk downloading and offline use. Use self-hosted data or a provider that explicitly permits offline packaging.

Showing a marker is different from calculating a route. The current route preview uses the bundled Mirpur graph, reports when coverage is unavailable, and must not be treated as full-Dhaka emergency navigation until authoritative shelter entrances, wider road coverage, and verified hazard blocking are added.

### Coordinate response format

Use decimal coordinates instead of sending a full GeoJSON object:

```text
RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:23.8069:90.3687:120:OPEN
```

For multiple locations:

```text
RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|1785362400|1785384000|MIRPUR:23.8069:90.3687:120:OPEN;UTTARA:23.8759:90.4002:80:OPEN
```

Use full status values in the current implementation: `OPEN`, `FULL`,
`CLOSED`, and `UNKNOWN`. Source, trust, verification time, and expiry are
mandatory in newly generated shelter responses. The Go service refreshes only
its clearly labelled demo seed records when it starts; production records must
receive their timestamps from the responsible authority's update workflow.

## 15. Advanced Feature Roadmap

These features can make SMSWeb more distinctive than a normal offline directory or SMS chatbot.

### Confidence-aware crisis map

Give every report a confidence score based on its source, age, and independent confirmations. Use different marker styles for verified, uncertain, disputed, and expired locations.

### Contradiction and rumor handling

If one SMS says a road is open and another says it is blocked, preserve both reports instead of silently overwriting one. Show the timestamps, sources, and confidence score.

### Priority-aware SMS queue

Queue messages according to urgency: medical emergency, missing person, shelter update, food or water request, then general announcement. Show whether each message is waiting, sent, confirmed, or failed.

### Store-and-forward relay

An authorized phone can carry encrypted records to another area and forward them when it reaches the service area. Add a time-to-live and maximum relay count to prevent endless circulation.

### Offline route-risk layer

Store flood zones, blocked roads, collapsed bridges, fire zones, crowded shelters, and supply shortages as local map layers. The first version can highlight risks; a later version can calculate routes using a local graph.

## 16. 30-Hour MVP Plan

A complete production system is much larger, but a demo-grade version of the main features can be built in approximately 30 focused hours.

### Required setup

- Android phone with active SIM
- Raspberry Pi
- USB power supply for both devices
- Local hotspot connection
- Android Studio
- Kotlin
- Node.js only if using the JavaScript simulator
- Go and SQLite for the service and administrator tools
- A small prebuilt map for one city or region

### 30-hour schedule

```text
Hours 1-3      Project setup and SMS protocol
Hours 4-8      Offline website, IndexedDB, and Service Worker
Hours 9-12     Offline map and shelter markers
Hours 13-17    Android SMS receiving and sending
Hours 18-20    Go service and SQLite database
Hours 21-23    Digital signatures for important alerts
Hours 24-26    Offline route calculation on a small road graph
Hours 27-28    Store-and-forward relay with expiry limits
Hours 29-30    Integration, testing, and presentation demo
```

### Simplified feature scope

To stay within 30 hours:

- Support one SMS service number.
- Support one city or region.
- Use a small predefined routing graph.
- Use one administrator role.
- Sign alerts and important reports only.
- Implement one relay hop first.
- Use compact SMS messages rather than full JSON.
- Use simulated data for features that are not connected to live SMS yet.

### Demonstration flow

```text
User sends SMS
      ↓
Android gateway receives SMS
      ↓
Gateway forwards request to Pi
      ↓
Go service processes request
      ↓
Gateway sends response SMS
      ↓
Offline app displays the result
```

### MVP acceptance criteria

The 30-hour MVP is successful when it can:

1. Receive a real SMS on an Android phone.
2. Send a predefined SMS request automatically.
3. Verify a signed crisis response.
4. Display a shelter marker without internet access.
5. Calculate a route on a small local road graph.
6. Queue and relay one encrypted message.
7. Manage shelters and alerts from a basic administrator screen.
8. Show message status, confidence, and expiry time.

### Features postponed after the MVP

- Multi-region map downloads
- Full navigation and turn-by-turn directions
- Multi-hop relay networks
- Production-grade key management
- Multiple administrator roles
- Large-scale SMS gateway infrastructure
- Comprehensive security auditing
- Automated conflict resolution across many disconnected devices

The objective of the 30-hour version is to demonstrate the complete end-to-end pipeline, not to build a production emergency-response platform.

## 17. Current Runbook

### A. Run the Go service on Windows

Open Git Bash in the project root:

```bash
cd service
export SMSWEB_AUTH_KEY='smsweb-local-judge-demo-key'
go run . -addr :8080 -db smsweb.db
```

Keep that terminal open. A successful startup ends with:

```text
SMSWeb crisis service listening on :8080
```

Check it from Postman or a browser:

```text
GET http://localhost:8080/health
```

Expected JSON:

```json
{"status":"ok"}
```

If the Android phone is connected through the PC's Wi-Fi or hotspot, run
`ipconfig`, find the PC IPv4 address on that network, and use
`http://PC-IP:8080` in the Android app. `localhost` on the phone means the phone,
not the PC.

### B. Build the separate Android editions

1. Open the `android-bridge` folder in Android Studio.
2. Wait for Gradle sync to finish.
3. Select the `gatewayDebug` variant and assemble it, then select `userDebug`
   and assemble it. From PowerShell, both can be built together:

   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   .\gradlew.bat :app:assembleGatewayDebug :app:assembleUserDebug
   ```

4. Install
   `app/build/outputs/apk/gateway/debug/app-gateway-debug.apk` on the gateway
   phone.
5. Install `app/build/outputs/apk/user/debug/app-user-debug.apk` on the user
   phone.

The editions use separate Android application IDs and names, and neither asks
the operator to select a role.

### B1. Configure the gateway phone

1. Allow SMS and location permissions.
2. Open **Administrator setup**.
3. Provision `smsweb-local-judge-demo-key`, matching `SMSWEB_AUTH_KEY` in the
   run command above.
4. Save `http://PC-IP:8080` as the Pi URL and select **Check connection**.
5. Save the gateway phone's own SMS number.

The key is entered by the deployment operator once. A person requesting shelter
information does not enter or receive it. Android stores it in app-private
preferences, uses it to verify Pi signatures and authorize local operator
updates, and does not expose a JavaScript getter for it.

### B2. Use the User phone

1. Install the User APK on the resident/test phone.
2. Allow SMS and location permissions.
3. The app opens on the interactive offline Greater Dhaka basemap with no
   preloaded emergency records. This makes it clear that all shelter, alert, and
   hazard information must arrive through the SMS protocol.
4. Tap **Shelters**, **Alerts**, or **Hazards** in the update panel to request
   current information. The
   User edition has no role, phone-number, Pi URL, or key setup.
5. When the response SMS returns from the configured gateway number, the app
   verifies it, blocks replays, stores it offline, and renders the relevant page.

When the Go service runs with `-demo`, its 18 shelters, three alerts, and four
hazards are demonstration source records. They reach the User app only through
the normal request, gateway, signed-response, SMS verification, and offline
storage flow.

The User APK is preconfigured for `+8801701485658`. If the gateway SIM changes,
rebuild only the User edition:

```powershell
.\gradlew.bat :app:assembleUserDebug `
  -PSMSWEB_USER_SERVICE_NUMBER="+8801XXXXXXXXX"
```

The fixed demo verification profile removes judge setup friction, but it is not
suitable for public distribution: extracting a shared secret from one client
would compromise every client. A production version must use asymmetric
signatures, where the authority keeps the private signing key and User APKs
contain only a public verification key.

### C. Real two-phone SMS test

1. Keep the Go service and SMSWeb Gateway APK running on the first phone.
2. Open the SMSWeb User APK on the second phone.
3. On the user phone, tap **Request shelters**, or send this to the gateway:

   ```text
   REQ|1|LIVE1|SHELTER|DHK
   ```

4. The gateway forwards the request to the local service.
5. The service returns signed multipart shelter data.
6. The gateway verifies the signature, sends the response SMS, and records
   `RECEIVED`, `FORWARDED`, `AUTHENTICATED`, and `HANDOFF` events.
7. The user phone independently verifies and renders the response.
8. Open **Shelters**, **Map**, and **Activity** on the user phone.
9. On **Map**, select **Use my location**. Wait for the reachable shelter list,
   which contains mapped-road distances only, then select
   **Show fastest safe route**. The map should zoom to a thick blue route and
   show a green route summary banner.

Request current road hazards with:

```text
REQ|1|LIVE2|HAZARD|DHK
```

Authenticated, unexpired hazard circles block intersecting road-graph edges.
Expired, demo-only, or unauthenticated records remain visibly labelled and do
not silently become trusted emergency facts.

### D. Publish an operator update

In the Android dashboard, expand **Authority operations console**. Publish a
shelter, alert, or hazard. The native bridge sends the JSON update to the Pi
with the privately stored key. The Go service validates coordinates, values,
expiry, identifiers, and allowed hazard types, then writes an audit entry.
Subsequent SMS requests include the update.

For direct Postman testing, send `X-SMSWeb-Key` with the operator key to:

```text
POST /admin/shelters
POST /admin/alerts
POST /admin/hazards
GET  /admin/state
```

### E. Honest prototype limitations

- The offline vector basemap covers greater Dhaka, but road routing is still
  limited to the bundled Mirpur graph. This is not full-Dhaka navigation.
- The bundled ten-location Dhaka dataset is demonstration data, not an
  authority-approved shelter registry. Coordinates, entrances, capacities, and
  accessibility must be field-checked before real use.
- The controlled-demo symmetric key proves only that a response used the same
  demo profile. It is not a national authority identity system, key rotation
  service, or secure public-client model. Public deployment requires
  asymmetric signatures.
- `HANDOFF` means Android accepted the SMS for transmission; it is not a
  carrier delivery receipt.
- Hazard avoidance is geometric intersection against a local graph. It needs
  wider, maintained road data and field validation before emergency deployment.
- The project is a working hackathon prototype, not a certified public-safety
  system.
