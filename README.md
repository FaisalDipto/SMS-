# SMSWeb

## An Offline Website Generated from SMS Responses

SMSWeb is an offline-first web interface that uses SMS as its data transport. Instead of sending an HTTP request to a traditional web server and waiting for an HTML response, the user sends a compact SMS command. A structured SMS response is received by the phone, decoded locally, stored offline, and rendered as a web page.

The system is designed for situations where mobile data or Wi-Fi internet is unavailable but cellular SMS is still working.

> Important limitation: a normal browser cannot read incoming SMS directly. A small Android companion application is required to read SMS and pass the content to the local web interface. The website itself can still be written with ordinary HTML, CSS, and JavaScript.

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
RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL
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
RES|VERSION|REQUEST_ID|PAGE|PART/TOTAL|REGION|PAYLOAD
```

Example:

```text
RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL
```

### 5.3 Alert format

```text
ALT|VERSION|ALERT_ID|PRIORITY|EXPIRES|REGION|MESSAGE
```

Example:

```text
ALT|1|F22P|HIGH|1764000000|DHK|Avoid road near Mirpur bridge
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
RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:120:OPEN;UTTARA:80:OPEN;DU:0:FULL
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
  "text": "RES|1|A17K|SHELTER|DHK|Mirpur Shelter|23.8069|90.3687|120|OPEN"
}
```

Example command flow:

```text
SHELTER + DHK
  -> query shelter records
  -> compact the records
  -> create RES response
  -> return response to SMS adapter
```

Use SQLite or JSON files for the first version. Add an administrator interface later for updating shelter and alert data.

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
RES|1|A17K|SHELTER|1/2|DHK|MIRPUR:120:OPEN;UTTARA:80:OPEN
RES|1|A17K|SHELTER|2/2|DHK|DU:0:FULL;GULSHAN:40:OPEN
```

The PWA should:

- Store each part temporarily.
- Wait until all parts arrive.
- Reassemble them in order.
- Reject incomplete data after a timeout.

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
Offline map package: region.pmtiles + map-style.json
SMS updates:         shelter coordinates stored in IndexedDB
Rendering:           MapLibre GL JS running locally
```

Example SMS response:

```text
RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:23.8069:90.3687:120:OPEN;UTTARA:23.8759:90.4002:80:OPEN;DU:23.7271:90.3944:0:FULL
```

The parser validates the latitude, longitude, status, timestamp, and expiry. A valid record is stored in IndexedDB and rendered as a marker on the local map. The marker and basemap require no internet request. The current demo seed coordinates identify named areas, not verified shelter entrances; they must be replaced with authoritative shelter coordinates before emergency navigation is enabled.

Recommended implementation:

- **MapLibre GL JS** for interactive vector-map rendering.
- **PMTiles** for packaging regional vector tiles into one offline archive.
- **IndexedDB** for shelters, hazards, and SMS reports.
- **Service Worker** for caching the application shell and map assets.

For a small proof of concept, Leaflet with a small local raster tile set is acceptable. Do not use `tile.openstreetmap.org` as an offline tile source; its policy prohibits bulk downloading and offline use. Use self-hosted data or a provider that explicitly permits offline packaging.

Showing a marker is different from calculating a route. Offline route calculation requires a local routing graph and is a later feature.

### Coordinate response format

Use decimal coordinates instead of sending a full GeoJSON object:

```text
RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:23.8069:90.3687:120:OPEN
```

For multiple locations:

```text
RES|1|A17K|SHELTER|1/1|DHK|MIRPUR:23.8069:90.3687:120:OPEN;UTTARA:23.8759:90.4002:80:OPEN
```

Use full status values in the current implementation: `OPEN`, `FULL`, `CLOSED`, and `UNKNOWN`. Include a timestamp, source, or confidence score when message size allows it.

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
