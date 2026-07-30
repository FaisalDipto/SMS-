(function attachRenderer(root, factory) {
  const renderer = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = renderer;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.renderer = renderer;
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const SHELTER_STATUSES = Object.freeze({
    OPEN: { label: 'Open', className: 'status-open' },
    FULL: { label: 'Full', className: 'status-full' },
    CLOSED: { label: 'Closed', className: 'status-closed' },
    UNKNOWN: { label: 'Unknown', className: 'status-unknown' }
  });
  const ALERT_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  const SHELTER_COORDINATES = Object.freeze({
    DU: { latitude: 23.7271, longitude: 90.3944 },
    MIRPUR: { latitude: 23.8069, longitude: 90.3687 },
    UTTARA: { latitude: 23.8759, longitude: 90.4002 }
  });

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function toMilliseconds(timestamp) {
    const numericTimestamp = Number(timestamp);

    if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
      return null;
    }

    return numericTimestamp < 1_000_000_000_000
      ? numericTimestamp * 1_000
      : numericTimestamp;
  }

  function formatTimestamp(timestamp) {
    const milliseconds = toMilliseconds(timestamp);

    if (milliseconds === null) {
      return 'Unknown time';
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(milliseconds));
  }

  function renderFreshness(expiresAt, now = Date.now()) {
    const milliseconds = toMilliseconds(expiresAt);

    if (milliseconds === null) {
      return '<span class="freshness freshness-unknown">Expiry not provided</span>';
    }

    if (milliseconds <= now) {
      return '<span class="freshness freshness-expired">Outdated information</span>';
    }

    return `<span class="freshness freshness-active">Expires ${escapeHtml(formatTimestamp(milliseconds))}</span>`;
  }

  function renderTrust(record, now = Date.now()) {
    const trust = String(record.trust || 'UNVERIFIED').toUpperCase();
    const authenticated = String(record.authentication || '').toUpperCase() === 'AUTHENTICATED';
    const trustLabels = {
      VERIFIED: 'Verified source',
      DEMO: 'Demo data',
      UNVERIFIED: 'Unverified'
    };
    const normalizedTrust = trustLabels[trust] ? trust : 'UNVERIFIED';
    const source = record.source || 'Unknown source';
    const verifiedAt = toMilliseconds(record.verifiedAt);
    const expiresAt = toMilliseconds(record.expiresAt);
    const isExpired = expiresAt !== null && expiresAt <= now;
    const displayLabel = authenticated
      ? normalizedTrust === 'VERIFIED' ? 'Authenticated source' : 'Authenticated demo'
      : 'Unverified message';
    const warning = !authenticated
      ? 'This message did not pass native gateway authentication and cannot be used for routing.'
      : normalizedTrust === 'VERIFIED'
      ? 'The message signature and source metadata passed gateway verification.'
      : normalizedTrust === 'DEMO'
        ? 'Demonstration records are not authority-verified emergency information.'
        : 'The origin of this information has not been verified.';
    const freshnessWarning = expiresAt === null
      ? 'Expiry is missing, so this information cannot be used for routing.'
      : isExpired
        ? 'This information has expired and cannot be used for routing.'
        : '';

    return `<details class="trust-panel trust-${normalizedTrust.toLowerCase()}" aria-label="Information trust and source">
      <summary>
        <span class="trust-heading">
          <span class="trust-badge">${escapeHtml(displayLabel)}</span>
          <strong>${escapeHtml(source)}</strong>
        </span>
        <span class="trust-more">Details</span>
      </summary>
      <div class="trust-details">
        <p>${verifiedAt === null
          ? 'Verification time not provided.'
          : `Checked ${escapeHtml(formatTimestamp(verifiedAt))}.`}</p>
        <p>${escapeHtml(warning)}</p>
        ${freshnessWarning ? `<p class="trust-warning">${escapeHtml(freshnessWarning)}</p>` : ''}
      </div>
    </details>`;
  }

  function renderMetadata(record, now, showFreshness = true) {
    const receivedAt = toMilliseconds(record.receivedAt);
    const receivedLabel = formatTimestamp(record.receivedAt);
    const datetime = receivedAt === null ? '' : new Date(receivedAt).toISOString();

    return `<div class="page-meta">
      <span>Last received <time datetime="${escapeHtml(datetime)}">${escapeHtml(receivedLabel)}</time></span>
      ${showFreshness ? renderFreshness(record.expiresAt, now) : ''}
    </div>`;
  }

  function renderPageFrame({
    pageClass,
    title,
    region,
    record,
    now,
    body,
    showFreshness = true,
    showTrust = false
  }) {
    const regionLabel = region && region !== '-' ?
      `<span class="region-label">${escapeHtml(region)}</span>` : '';

    return `<article class="page-view ${escapeHtml(pageClass)}">
      <header class="page-view-header">
        <div>
          <p class="eyebrow">Local information ${regionLabel}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${showFreshness ? renderFreshness(record.expiresAt, now) : ''}
      </header>
      ${showTrust ? renderTrust(record, now) : ''}
      ${body}
      ${renderMetadata(record, now, showFreshness)}
    </article>`;
  }

  function renderHomePage(page = {}, now = Date.now()) {
    const cards = Array.isArray(page.cards) ? page.cards : [
      { page: 'SHELTER', title: 'Find shelters', description: 'View the latest available shelter spaces.' },
      { page: 'ALERTS', title: 'Emergency alerts', description: 'Review warnings received by SMS.' },
      { page: 'HAZARDS', title: 'Road hazards', description: 'See authenticated closures and danger zones.' },
      { page: 'MAP', title: 'Safe route map', description: 'Route on the bundled offline road graph.' }
    ];
    const body = `<p class="page-summary">${escapeHtml(page.message || 'Choose an information page to get started.')}</p>
      <div class="info-card-grid">
        ${cards.map((card) => `<article class="info-card" data-page="${escapeHtml(card.page || '')}">
          <h3>${escapeHtml(card.title || 'Information')}</h3>
          <p>${escapeHtml(card.description || '')}</p>
        </article>`).join('')}
      </div>`;

    return renderPageFrame({
      pageClass: 'page-view-home',
      title: page.title || 'SMSWeb',
      region: page.region,
      record: page,
      now,
      body
    });
  }

  function parseShelterPayload(payload) {
    if (typeof payload !== 'string') {
      throw new Error('Shelter payload must be a string');
    }

    if (payload.trim() === '') {
      return [];
    }

    return payload.split(';').map((entry) => {
      const fields = entry.split(':');

      if (fields.length !== 3 && fields.length !== 5) {
        throw new Error('Shelter entries must use LOCATION:SPACES:STATUS or LOCATION:LATITUDE:LONGITUDE:SPACES:STATUS');
      }

      const location = fields[0].trim();
      const coordinateFields = fields.length === 5 ? fields.slice(1, 3).map(Number) : [];
      const spaces = Number(fields.length === 5 ? fields[3] : fields[1]);
      const status = fields[fields.length - 1].trim().toUpperCase();

      if (!location || !Number.isInteger(spaces) || spaces < 0) {
        throw new Error('Shelter location and spaces are invalid');
      }

      if (fields.length === 5 && (
        !Number.isFinite(coordinateFields[0]) || coordinateFields[0] < -90 || coordinateFields[0] > 90 ||
        !Number.isFinite(coordinateFields[1]) || coordinateFields[1] < -180 || coordinateFields[1] > 180
      )) {
        throw new Error('Shelter coordinates are invalid');
      }

      if (!SHELTER_STATUSES[status]) {
        throw new Error(`Unknown shelter status: ${status}`);
      }

      const shelter = { location, spaces, status };
      if (fields.length === 5) {
        shelter.latitude = coordinateFields[0];
        shelter.longitude = coordinateFields[1];
      }
      return shelter;
    });
  }

  function renderShelterPage(page, now = Date.now()) {
    const shelters = parseShelterPayload(page.payload ?? page.content ?? '');
    const openShelters = shelters.filter((shelter) => shelter.status === 'OPEN');
    const availableSpaces = openShelters.reduce((total, shelter) => total + shelter.spaces, 0);
    const body = shelters.length === 0
      ? '<p class="empty-state">No shelter update has been received yet. Tap <strong>Get shelters</strong> in the SMS update panel to request one.</p>'
      : `<div class="shelter-overview" aria-label="Shelter availability summary">
          <span><strong>${openShelters.length}</strong> open shelters</span>
          <span><strong>${availableSpaces}</strong> spaces available</span>
        </div>
        <ul class="resource-list">
          ${shelters.map((shelter) => {
            const status = SHELTER_STATUSES[shelter.status];
            return `<li class="resource-item shelter-item" data-shelter-status="${escapeHtml(shelter.status)}">
              <span class="resource-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9h-6v-6H9v6H3v-9Z"></path></svg>
              </span>
              <div class="resource-copy">
                <h3>${escapeHtml(shelter.location)}</h3>
                <p>${escapeHtml(shelter.spaces)} spaces available</p>
              </div>
              <span class="status-badge ${status.className}">${status.label}</span>
            </li>`;
          }).join('')}
        </ul>`;

    return renderPageFrame({
      pageClass: 'page-view-shelter',
      title: page.title || 'Emergency Shelters',
      region: page.region,
      record: page,
      now,
      body,
      showTrust: true
    });
  }

  function renderAlertsPage(alerts, now = Date.now()) {
    const priorityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const records = Array.isArray(alerts)
      ? alerts.slice().sort((left, right) =>
        (priorityRank[right.priority] || 0) - (priorityRank[left.priority] || 0) ||
        (toMilliseconds(right.receivedAt) || 0) - (toMilliseconds(left.receivedAt) || 0)
      )
      : [];
    const body = records.length === 0
      ? '<p class="empty-state">No alert update has been received yet. Tap <strong>Get alerts</strong> in the SMS update panel to request one.</p>'
      : `<ul class="resource-list alert-list">
          ${records.map((alert) => {
            const priority = ALERT_PRIORITIES.has(alert.priority) ? alert.priority : 'UNKNOWN';
            const priorityClass = priority === 'UNKNOWN' ? 'priority-unknown' : `priority-${priority.toLowerCase()}`;
            const expiresAt = alert.expiresAt ?? alert.expires;
            const authenticated =
              String(alert.authentication || '').toUpperCase() === 'AUTHENTICATED';
            return `<li class="resource-item alert-item ${priorityClass}">
              <span class="resource-symbol alert-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9.5 21h5"></path></svg>
              </span>
              <div class="resource-copy">
                <div class="resource-kicker">
                  <p class="alert-priority">${escapeHtml(priority)}</p>
                  <p class="trust-badge">${authenticated ? 'Authenticated' : 'Unverified'}</p>
                </div>
                <h3>${escapeHtml(alert.message)}</h3>
                <p>${escapeHtml(alert.region && alert.region !== '-' ? alert.region : 'All regions')}</p>
              </div>
              ${renderFreshness(expiresAt, now)}
            </li>`;
          }).join('')}
        </ul>`;

    const record = {
      receivedAt: records.reduce((latest, alert) => Math.max(latest, toMilliseconds(alert.receivedAt) || 0), 0),
      expiresAt: records.reduce((earliest, alert) => {
        const expiry = toMilliseconds(alert.expiresAt ?? alert.expires);
        return expiry === null ? earliest : Math.min(earliest, expiry);
      }, Number.MAX_SAFE_INTEGER)
    };

    if (record.receivedAt === 0) {
      delete record.receivedAt;
    }
    if (record.expiresAt === Number.MAX_SAFE_INTEGER) {
      delete record.expiresAt;
    }

    return renderPageFrame({
      pageClass: 'page-view-alerts',
      title: 'Emergency Alerts',
      record,
      now,
      body
    });
  }

  function renderHazardsPage(hazards, now = Date.now()) {
    const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const records = Array.isArray(hazards)
      ? hazards.slice().sort((left, right) =>
        (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0) ||
        (toMilliseconds(right.receivedAt) || 0) - (toMilliseconds(left.receivedAt) || 0)
      )
      : [];
    const body = records.length === 0
      ? '<p class="empty-state">No hazard update has been received yet. Tap <strong>Get hazards</strong> in the SMS update panel to request one.</p>'
      : `<ul class="resource-list hazard-list">
          ${records.map((hazard) => {
            const authenticated =
              String(hazard.authentication || '').toUpperCase() === 'AUTHENTICATED';
            return `<li class="resource-item hazard-item priority-${escapeHtml(
              String(hazard.severity || 'UNKNOWN').toLowerCase()
            )}">
              <span class="resource-symbol hazard-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3v.5"></path></svg>
              </span>
              <div class="resource-copy">
                <div class="resource-kicker">
                  <p class="alert-priority">${escapeHtml(hazard.severity || 'UNKNOWN')}</p>
                  <p class="trust-badge">${authenticated ? 'Authenticated' : 'Unverified'}</p>
                </div>
                <h3>${escapeHtml(String(hazard.kind || 'HAZARD').replaceAll('_', ' '))}</h3>
                <p class="resource-place">${escapeHtml(hazard.roadName || 'Unnamed road')}</p>
                ${hazard.description ? `<p>${escapeHtml(hazard.description)}</p>` : ''}
                <p class="resource-detail">${escapeHtml(`${hazard.radiusMeters || 0} m avoidance zone`)}</p>
              </div>
              ${renderFreshness(hazard.expiresAt, now)}
            </li>`;
          }).join('')}
        </ul>`;
    const record = {
      receivedAt: records.reduce((latest, hazard) =>
        Math.max(latest, toMilliseconds(hazard.receivedAt) || 0), 0),
      expiresAt: records.reduce((earliest, hazard) => {
        const expiry = toMilliseconds(hazard.expiresAt);
        return expiry === null ? earliest : Math.min(earliest, expiry);
      }, Number.MAX_SAFE_INTEGER)
    };
    if (record.receivedAt === 0) delete record.receivedAt;
    if (record.expiresAt === Number.MAX_SAFE_INTEGER) delete record.expiresAt;
    return renderPageFrame({
      pageClass: 'page-view-hazards',
      title: 'Road Hazards',
      region: records[0]?.region || 'DHK',
      record,
      now,
      body
    });
  }

  function renderMapPage(page = {}, now = Date.now()) {
    const shelters = parseShelterPayload(page.payload ?? page.content ?? '');
    const hazards = (Array.isArray(page.hazards) ? page.hazards : [])
      .filter((hazard) => Number.isFinite(hazard.expiresAt) && hazard.expiresAt > now);
    const bounds = { minLatitude: 23.70, maxLatitude: 23.90, minLongitude: 90.34, maxLongitude: 90.43 };
    const markerRecords = shelters
      .map((shelter) => ({
        ...shelter,
        coordinates: shelter.latitude === undefined
          ? SHELTER_COORDINATES[shelter.location]
          : { latitude: shelter.latitude, longitude: shelter.longitude }
      }))
      .filter((shelter) => shelter.coordinates);
    const markers = markerRecords.map((shelter) => {
        const left = ((shelter.coordinates.longitude - bounds.minLongitude) /
          (bounds.maxLongitude - bounds.minLongitude)) * 100;
        const top = ((bounds.maxLatitude - shelter.coordinates.latitude) /
          (bounds.maxLatitude - bounds.minLatitude)) * 100;
        const statusClass = shelter.status.toLowerCase();
        return `<button type="button" class="map-marker map-marker-${escapeHtml(statusClass)}"
          style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%"
          data-map-location="${escapeHtml(shelter.location)}"
          data-map-spaces="${escapeHtml(shelter.spaces)}"
          data-map-status="${escapeHtml(shelter.status)}"
          data-map-latitude="${escapeHtml(shelter.coordinates.latitude)}"
          data-map-longitude="${escapeHtml(shelter.coordinates.longitude)}"
          title="${escapeHtml(`${shelter.location}: ${shelter.spaces} spaces, ${shelter.status}`)}"
          aria-label="${escapeHtml(`${shelter.location}, ${shelter.spaces} spaces, ${shelter.status}`)}"></button>`;
      }).join('');
    const unknownLocations = shelters.filter((shelter) =>
      shelter.latitude === undefined && !SHELTER_COORDINATES[shelter.location]
    );
    const hazardMarkers = hazards.map((hazard) => {
      const left = ((hazard.longitude - bounds.minLongitude) /
        (bounds.maxLongitude - bounds.minLongitude)) * 100;
      const top = ((bounds.maxLatitude - hazard.latitude) /
        (bounds.maxLatitude - bounds.minLatitude)) * 100;
      return `<button type="button" class="map-hazard-marker"
        style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%"
        data-map-hazard="${escapeHtml(hazard.hazardId)}"
        data-map-hazard-kind="${escapeHtml(hazard.kind)}"
        data-map-hazard-road="${escapeHtml(hazard.roadName)}"
        data-map-hazard-severity="${escapeHtml(hazard.severity)}"
        data-map-hazard-radius="${escapeHtml(hazard.radiusMeters)}"
        data-map-hazard-latitude="${escapeHtml(hazard.latitude)}"
        data-map-hazard-longitude="${escapeHtml(hazard.longitude)}"
        data-map-hazard-expires="${escapeHtml(hazard.expiresAt)}"
        data-map-hazard-authentication="${escapeHtml(hazard.authentication || 'UNVERIFIED')}"
        title="${escapeHtml(`${hazard.kind} on ${hazard.roadName}`)}"
        aria-label="${escapeHtml(`${hazard.severity} ${hazard.kind} on ${hazard.roadName}`)}"></button>`;
    }).join('');
    const expiresAt = toMilliseconds(page.expiresAt);
    const authenticated = String(page.authentication || '').toUpperCase() === 'AUTHENTICATED';
    const canRoute = authenticated && expiresAt !== null && expiresAt > now;
    const body = `<div class="map-placeholder map-data-view" aria-label="Offline greater Dhaka shelter map">
      <div id="offline-vector-map" class="offline-vector-map" role="application" aria-label="Interactive offline greater Dhaka map"></div>
      <div id="map-legacy-layer" class="map-legacy-layer">
      <div id="map-viewport" class="map-viewport">
        <svg class="map-basemap" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <rect width="100" height="100" class="map-land"></rect>
          <path class="map-water" d="M4 0 C18 18 13 34 25 48 S20 76 7 100 L0 100 L0 0 Z"></path>
          <path class="map-road map-road-major" d="M12 92 C25 73 32 57 39 42 S57 16 72 4"></path>
          <path class="map-road map-road-major" d="M2 64 C23 59 42 58 61 62 S84 73 100 86"></path>
          <path class="map-road" d="M10 25 C29 31 48 29 70 20 S88 10 100 9"></path>
          <path class="map-road" d="M35 100 C43 82 52 70 68 58 S83 36 92 15"></path>
          <path class="map-road" d="M18 76 C37 72 55 76 78 91"></path>
          <path id="map-offline-roads" class="map-offline-roads" d=""></path>
          <text x="69" y="11" class="map-place-label">UTTARA</text>
          <text x="27" y="54" class="map-place-label">MIRPUR</text>
          <text x="55" y="83" class="map-place-label">DU</text>
          <text x="5" y="96" class="map-river-label">BURIGANGA</text>
        </svg>
        <div class="map-grid" aria-hidden="true"></div>
        <svg class="map-route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g id="map-road-labels" class="map-road-labels"></g>
          <path id="map-route-line" class="map-route-line" d=""></path>
          <circle id="map-user-location" class="map-user-location" cx="0" cy="0" r="1.2"></circle>
        </svg>
        <div class="map-label">Loading detailed greater Dhaka map...</div>
        ${markers || '<p>No shelters with bundled coordinates are available.</p>'}
        ${hazardMarkers}
      </div>
      <div class="map-controls" aria-label="Map controls">
        <button id="map-zoom-in" type="button" aria-label="Zoom in">+</button>
        <button id="map-zoom-out" type="button" aria-label="Zoom out">−</button>
        <button id="map-rotate-left" type="button" aria-label="Rotate map left">↶</button>
        <button id="map-rotate-right" type="button" aria-label="Rotate map right">↷</button>
        <button id="map-reset-view" type="button">Reset view</button>
      </div>
      </div>
      <div id="map-route-banner" class="map-route-banner" role="status" aria-live="polite" hidden></div>
      </div>
      <div class="map-summary">
        <span>${markerRecords.length > 0 ? `${markerRecords.length} shelter markers` : 'No shelter markers'}</span>
        <span>${hazards.length} active hazard${hazards.length === 1 ? '' : 's'}</span>
      </div>
      ${markerRecords.length === 0 ? `<section class="map-empty-state" aria-label="How to load safety information">
        <div class="map-empty-symbol" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Zm4 4h8M8 12h5"></path></svg>
        </div>
        <div>
          <p class="eyebrow">Waiting for an SMS update</p>
          <h3>Your map is ready. Safety data is not preloaded.</h3>
          <p>Tap <strong>Get shelters</strong> above. The request goes by SMS to the gateway; authenticated shelter markers appear here when its response arrives.</p>
        </div>
      </section>` : ''}
      <p class="hazard-routing-note">${hazards.length > 0
        ? `${hazards.length} current hazard zone${hazards.length === 1 ? '' : 's'} loaded. Authenticated zones are excluded from route calculation.`
        : 'No current hazard zones are loaded; routes use the available road graph.'}</p>
      <div class="map-distance-panel">
        <div class="map-guidance">
          <span class="map-guidance-step">1</span>
          <p>Locate yourself, then SMSWeb compares reachable shelters using the bundled road network.</p>
        </div>
        <div class="map-action-row">
          <button id="map-locate" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v3m0 14v3M2 12h3m14 0h3m-5 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z"></path></svg>
            <span class="button-label">Use my location</span>
          </button>
          <button id="map-route" type="button" data-route-allowed="${canRoute}" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20c0-7 12-5 12-12m0 0-3 3m3-3 3 3M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"></path></svg>
            <span class="button-label">Show fastest safe route</span>
          </button>
        </div>
        <p id="map-location-status" class="map-action-status" role="status" aria-live="polite">Tap “Use my location” to find shelters reachable on mapped roads.</p>
        <ul id="map-distance-list" class="map-distance-list" aria-live="polite"></ul>
        <div id="map-route-result" class="map-route-result" data-state="idle">
        <p id="map-route-status" class="map-action-status" role="status" aria-live="polite">${canRoute
          ? 'The route button will unlock after your location and reachable road paths are ready.'
          : authenticated
            ? 'Routing is disabled until current shelter information with an expiry time is received.'
            : 'Routing is disabled because this shelter message was not authenticated by the gateway.'}</p>
        <p id="map-route-location" class="map-note"></p>
        <ul id="map-route-roads" class="map-route-roads" aria-live="polite"></ul>
        </div>
        <p class="map-attribution">Road data: &copy; OpenStreetMap contributors</p>
      </div>
      <p class="map-selection" id="map-selection">Tap a marker to view shelter details.</p>
      <p id="map-data-note" class="map-note">Detailed basemap data is bundled for offline use. Route calculation currently uses the separate verified Mirpur road graph.</p>
      ${unknownLocations.length > 0
        ? `<p class="map-note">No bundled coordinate is available for ${escapeHtml(unknownLocations.map((shelter) => shelter.location).join(', '))}.</p>`
        : ''}`;

    return renderPageFrame({
      pageClass: 'page-view-map',
      title: 'Safety map',
      region: page.region || 'DHK',
      record: page,
      now,
      body,
      showTrust: true
    });
  }

  function renderActivityPage(messages = [], now = Date.now()) {
    const records = Array.isArray(messages) ? messages : [];
    const activity = records.length === 0
      ? '<p class="empty-state">No SMS activity has been recorded yet.</p>'
      : `<ul class="activity-list">
          ${records.map((message) => {
            const gatewayEvent = Boolean(message.state);
            const direction = gatewayEvent
              ? 'Gateway event'
              : message.direction === 'outgoing' ? 'Sent request' : 'Received response';
            const status = String(message.state || message.status || 'unknown').toUpperCase();
            const content = gatewayEvent ? message.detail : message.rawText;
            return `<li class="activity-item">
              <div>
                <p class="activity-direction">${escapeHtml(direction)}</p>
                <p class="activity-status">${escapeHtml(status)} · ${escapeHtml(message.requestId || 'unknown ID')}</p>
                <code>${escapeHtml(content || '')}</code>
              </div>
              <time>${escapeHtml(formatTimestamp(message.createdAt))}</time>
            </li>`;
          }).join('')}
        </ul>`;
    const body = `${activity}
      <button id="activity-retry" class="activity-retry" type="button">Retry queued gateway messages</button>
      <p id="activity-retry-status" class="map-note" role="status" aria-live="polite"></p>`;
    const latest = records.reduce((latestTime, message) =>
      Math.max(latestTime, toMilliseconds(message.createdAt) || 0), 0);

    return renderPageFrame({
      pageClass: 'page-view-activity',
      title: 'Message activity',
      record: latest ? { receivedAt: latest } : {},
      now,
      body,
      showFreshness: false
    });
  }

  function renderPage(page, now = Date.now()) {
    switch (page.page || page.type) {
      case 'HOME':
        return renderHomePage(page, now);
      case 'SHELTER':
        return renderShelterPage(page, now);
      case 'ALERTS':
        return renderAlertsPage(page.alerts, now);
      case 'ACTIVITY':
        return renderActivityPage(page.messages, now);
      default:
        throw new Error(`Unsupported page: ${page.page || page.type}`);
    }
  }

  function mount(container, html) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new Error('A DOM container is required');
    }

    const template = container.ownerDocument.createElement('template');
    template.innerHTML = html;
    container.replaceChildren(template.content.cloneNode(true));
  }

  return {
    escapeHtml,
    formatTimestamp,
    renderFreshness,
    renderTrust,
    parseShelterPayload,
    renderHomePage,
    renderShelterPage,
    renderAlertsPage,
    renderHazardsPage,
    renderMapPage,
    renderActivityPage,
    renderPage,
    mount
  };
});
