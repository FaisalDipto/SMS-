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

  function renderMetadata(record, now) {
    const receivedAt = toMilliseconds(record.receivedAt);
    const receivedLabel = formatTimestamp(record.receivedAt);
    const datetime = receivedAt === null ? '' : new Date(receivedAt).toISOString();

    return `<div class="page-meta">
      <span>Last received <time datetime="${escapeHtml(datetime)}">${escapeHtml(receivedLabel)}</time></span>
      ${renderFreshness(record.expiresAt, now)}
    </div>`;
  }

  function renderPageFrame({ pageClass, title, region, record, now, body }) {
    const regionLabel = region && region !== '-' ?
      `<span class="region-label">${escapeHtml(region)}</span>` : '';

    return `<article class="page-view ${escapeHtml(pageClass)}">
      <header class="page-view-header">
        <div>
          <p class="eyebrow">Local information ${regionLabel}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${renderFreshness(record.expiresAt, now)}
      </header>
      ${body}
      ${renderMetadata(record, now)}
    </article>`;
  }

  function renderHomePage(page = {}, now = Date.now()) {
    const cards = Array.isArray(page.cards) ? page.cards : [
      { page: 'SHELTER', title: 'Find shelters', description: 'View the latest available shelter spaces.' },
      { page: 'ALERTS', title: 'Emergency alerts', description: 'Review warnings received by SMS.' }
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

      if (fields.length !== 3) {
        throw new Error('Shelter entries must use LOCATION:SPACES:STATUS');
      }

      const location = fields[0].trim();
      const spaces = Number(fields[1]);
      const status = fields[2].trim().toUpperCase();

      if (!location || !Number.isInteger(spaces) || spaces < 0) {
        throw new Error('Shelter location and spaces are invalid');
      }

      if (!SHELTER_STATUSES[status]) {
        throw new Error(`Unknown shelter status: ${status}`);
      }

      return { location, spaces, status };
    });
  }

  function renderShelterPage(page, now = Date.now()) {
    const shelters = parseShelterPayload(page.payload ?? page.content ?? '');
    const body = shelters.length === 0
      ? '<p class="empty-state">No shelter records were included in this response.</p>'
      : `<ul class="resource-list">
          ${shelters.map((shelter) => {
            const status = SHELTER_STATUSES[shelter.status];
            return `<li class="resource-item">
              <div>
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
      body
    });
  }

  function renderAlertsPage(alerts, now = Date.now()) {
    const records = Array.isArray(alerts) ? alerts : [];
    const body = records.length === 0
      ? '<p class="empty-state">No active alerts are available.</p>'
      : `<ul class="resource-list alert-list">
          ${records.map((alert) => {
            const priority = ALERT_PRIORITIES.has(alert.priority) ? alert.priority : 'UNKNOWN';
            const priorityClass = priority === 'UNKNOWN' ? 'priority-unknown' : `priority-${priority.toLowerCase()}`;
            const expiresAt = alert.expiresAt ?? alert.expires;
            return `<li class="resource-item alert-item ${priorityClass}">
              <div>
                <p class="alert-priority">${escapeHtml(priority)}</p>
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

  function renderMapPage(page = {}, now = Date.now()) {
    const shelters = parseShelterPayload(page.payload ?? page.content ?? '');
    const bounds = { minLatitude: 23.70, maxLatitude: 23.90, minLongitude: 90.34, maxLongitude: 90.43 };
    const markerRecords = shelters
      .map((shelter) => ({ ...shelter, coordinates: SHELTER_COORDINATES[shelter.location] }))
      .filter((shelter) => shelter.coordinates);
    const markers = markerRecords.map((shelter) => {
        const left = ((shelter.coordinates.longitude - bounds.minLongitude) /
          (bounds.maxLongitude - bounds.minLongitude)) * 100;
        const top = ((bounds.maxLatitude - shelter.coordinates.latitude) /
          (bounds.maxLatitude - bounds.minLatitude)) * 100;
        const statusClass = shelter.status.toLowerCase();
        return `<span class="map-marker map-marker-${escapeHtml(statusClass)}"
          style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%"
          title="${escapeHtml(`${shelter.location}: ${shelter.spaces} spaces, ${shelter.status}`)}"
          aria-label="${escapeHtml(`${shelter.location}, ${shelter.spaces} spaces, ${shelter.status}`)}"></span>`;
      }).join('');
    const unknownLocations = shelters.filter((shelter) => !SHELTER_COORDINATES[shelter.location]);
    const body = `<div class="map-placeholder map-data-view" role="img" aria-label="Offline Dhaka shelter map">
        <div class="map-grid" aria-hidden="true"></div>
        <div class="map-label">DHK shelter markers</div>
        ${markers || '<p>No shelters with bundled coordinates are available.</p>'}
      </div>
      <div class="map-summary">
        <span>${markerRecords.length > 0 ? `${markerRecords.length} shelter markers` : 'No shelter markers'}</span>
        <span>Offline coordinates</span>
      </div>
      ${unknownLocations.length > 0
        ? `<p class="map-note">No bundled coordinate is available for ${escapeHtml(unknownLocations.map((shelter) => shelter.location).join(', '))}.</p>`
        : ''}`;

    return renderPageFrame({
      pageClass: 'page-view-map',
      title: 'Crisis map',
      region: page.region || 'DHK',
      record: page,
      now,
      body
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
    parseShelterPayload,
    renderHomePage,
    renderShelterPage,
    renderAlertsPage,
    renderMapPage,
    renderPage,
    mount
  };
});
