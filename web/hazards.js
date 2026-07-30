(function attachHazards(root, factory) {
  const hazards = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = hazards;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.hazards = hazards;
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const KIND_CODES = Object.freeze({
    C: 'ROAD_CLOSED',
    F: 'FLOOD',
    R: 'FIRE',
    U: 'UNSAFE'
  });
  const SEVERITY_CODES = Object.freeze({
    L: 'LOW',
    M: 'MEDIUM',
    H: 'HIGH',
    C: 'CRITICAL'
  });

  function parseHazardPayload(payload) {
    if (typeof payload !== 'string') {
      throw new Error('Hazard payload must be text');
    }
    if (payload.trim() === '') return [];

    return payload.split(';').map((record) => {
      const fields = record.split(':');
      if (fields.length !== 7) {
        throw new Error('Hazards must use ID:KIND:LATITUDE:LONGITUDE:RADIUS:SEVERITY:ROAD');
      }
      const [hazardId, kindCode, latitudeText, longitudeText, radiusText, severityCode, road] = fields;
      const latitude = Number(latitudeText);
      const longitude = Number(longitudeText);
      const radiusMeters = Number(radiusText);
      if (!/^[A-Z0-9]{2,16}$/.test(hazardId)) {
        throw new Error('Hazard ID is invalid');
      }
      if (!KIND_CODES[kindCode] || !SEVERITY_CODES[severityCode]) {
        throw new Error('Hazard kind or severity is invalid');
      }
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('Hazard coordinates are invalid');
      }
      if (!Number.isFinite(radiusMeters) || radiusMeters < 10 || radiusMeters > 2_000) {
        throw new Error('Hazard radius is invalid');
      }
      if (!road) throw new Error('Hazard road name is required');

      return {
        hazardId,
        kind: KIND_CODES[kindCode],
        latitude,
        longitude,
        radiusMeters,
        severity: SEVERITY_CODES[severityCode],
        roadName: road.replaceAll('_', ' ')
      };
    });
  }

  return Object.freeze({
    KIND_CODES,
    SEVERITY_CODES,
    parseHazardPayload
  });
});
