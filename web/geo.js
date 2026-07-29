(function attachGeo(root, factory) {
  const geo = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = geo;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.geo = geo;
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const EARTH_RADIUS_KM = 6371.0088;

  function assertCoordinate(point, field) {
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) {
      throw new Error(`${field} coordinates are invalid`);
    }
  }

  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  function distanceKm(from, to) {
    assertCoordinate(from, 'Origin');
    assertCoordinate(to, 'Destination');

    const latitudeDelta = toRadians(to.latitude - from.latitude);
    const longitudeDelta = toRadians(to.longitude - from.longitude);
    const originLatitude = toRadians(from.latitude);
    const destinationLatitude = toRadians(to.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(originLatitude) * Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  function formatDistance(kilometers) {
    if (!Number.isFinite(kilometers) || kilometers < 0) return 'Unknown distance';
    if (kilometers < 1) return `${Math.round(kilometers * 1000)} m`;
    return `${kilometers.toFixed(1)} km`;
  }

  return Object.freeze({ distanceKm, formatDistance });
});
