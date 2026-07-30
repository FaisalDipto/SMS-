(function attachOfflineMap(root, factory) {
  const offlineMap = factory({
    maplibregl: root?.maplibregl,
    pmtiles: root?.pmtiles,
    basemaps: root?.basemaps
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = offlineMap;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.offlineMap = offlineMap;
  }
})(typeof window !== 'undefined' ? window : globalThis, (dependencies) => {
  'use strict';

  const { maplibregl, pmtiles, basemaps } = dependencies;
  const ARCHIVE_KEY = 'smsweb-greater-dhaka';
  const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: [] });

  class BundledArchiveSource {
    constructor(url) {
      this.url = url;
      this.archivePromise = null;
    }

    getKey() {
      return ARCHIVE_KEY;
    }

    async getBytes(offset, length) {
      if (!this.archivePromise) {
        this.archivePromise = fetch(this.url).then((response) => {
          if (!response.ok) {
            throw new Error(`Offline map package could not be loaded (${response.status})`);
          }
          return response.arrayBuffer();
        });
      }

      const archive = await this.archivePromise;
      return { data: archive.slice(offset, offset + length) };
    }
  }

  function featureCollection(features = []) {
    return { type: 'FeatureCollection', features };
  }

  function shelterFeatures(shelters) {
    return featureCollection(shelters.map((shelter) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [shelter.coordinates.longitude, shelter.coordinates.latitude]
      },
      properties: {
        location: shelter.location,
        spaces: Number(shelter.spaces),
        status: shelter.status
      }
    })));
  }

  function routeFeature(route) {
    if (!route?.coordinates?.length) return EMPTY_COLLECTION;
    return featureCollection([{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: route.coordinates.map(({ longitude, latitude }) => [longitude, latitude])
      },
      properties: {}
    }]);
  }

  function hazardFeatures(hazards) {
    return featureCollection((Array.isArray(hazards) ? hazards : []).map((hazard) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [hazard.longitude, hazard.latitude]
      },
      properties: {
        hazardId: hazard.hazardId,
        kind: hazard.kind,
        severity: hazard.severity,
        roadName: hazard.roadName,
        radiusMeters: Number(hazard.radiusMeters)
      }
    })));
  }

  function hazardAreaFeatures(hazards) {
    return featureCollection((Array.isArray(hazards) ? hazards : []).map((hazard) => {
      const latitudeRadians = hazard.latitude * Math.PI / 180;
      const latitudeRadius = hazard.radiusMeters / 110_540;
      const longitudeRadius = hazard.radiusMeters /
        Math.max(1, 111_320 * Math.cos(latitudeRadians));
      const coordinates = Array.from({ length: 33 }, (_unused, index) => {
        const angle = (index / 32) * Math.PI * 2;
        return [
          hazard.longitude + Math.cos(angle) * longitudeRadius,
          hazard.latitude + Math.sin(angle) * latitudeRadius
        ];
      });
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coordinates] },
        properties: {
          hazardId: hazard.hazardId,
          severity: hazard.severity
        }
      };
    }));
  }

  function pointFeature(coordinate) {
    if (!coordinate) return EMPTY_COLLECTION;
    return featureCollection([{
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [coordinate.longitude, coordinate.latitude]
      },
      properties: {}
    }]);
  }

  function buildStyle(archiveUrl, shelters, hazards = []) {
    const baseUrl = new URL('.', document.baseURI).href;
    const baseLayers = basemaps.layers(
      'protomaps',
      basemaps.namedFlavor('light'),
      { lang: 'en' }
    );

    return {
      version: 8,
      glyphs: `${baseUrl}vendor/fonts/{fontstack}/{range}.pbf`,
      sprite: `${baseUrl}vendor/sprites/v4/light`,
      sources: {
        protomaps: {
          type: 'vector',
          url: archiveUrl,
          attribution: '© OpenStreetMap contributors · Protomaps'
        },
        shelters: {
          type: 'geojson',
          data: shelterFeatures(shelters)
        },
        route: {
          type: 'geojson',
          data: EMPTY_COLLECTION
        },
        userLocation: {
          type: 'geojson',
          data: EMPTY_COLLECTION
        },
        hazards: {
          type: 'geojson',
          data: hazardFeatures(hazards)
        },
        hazardAreas: {
          type: 'geojson',
          data: hazardAreaFeatures(hazards)
        }
      },
      layers: [
        ...baseLayers,
        {
          id: 'smsweb-route-casing',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#ffffff',
            'line-width': 8,
            'line-opacity': 0.95
          }
        },
        {
          id: 'smsweb-route',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#0759d7',
            'line-width': 5
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          }
        },
        {
          id: 'smsweb-shelters',
          type: 'circle',
          source: 'shelters',
          paint: {
            'circle-radius': 9,
            'circle-color': [
              'case',
              ['==', ['get', 'status'], 'OPEN'],
              '#16a34a',
              '#dc2626'
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3
          }
        },
        {
          id: 'smsweb-shelter-labels',
          type: 'symbol',
          source: 'shelters',
          minzoom: 11,
          layout: {
            'text-field': ['get', 'location'],
            'text-font': ['Noto Sans Medium'],
            'text-size': 13,
            'text-offset': [0, 1.4],
            'text-anchor': 'top'
          },
          paint: {
            'text-color': '#123c38',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
          }
        },
        {
          id: 'smsweb-hazard-radius',
          type: 'fill',
          source: 'hazardAreas',
          paint: {
            'fill-color': '#f97316',
            'fill-opacity': 0.18,
            'fill-outline-color': '#c2410c'
          }
        },
        {
          id: 'smsweb-hazards',
          type: 'circle',
          source: 'hazards',
          paint: {
            'circle-radius': 8,
            'circle-color': [
              'case',
              ['==', ['get', 'severity'], 'CRITICAL'],
              '#b91c1c',
              '#ea580c'
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3
          }
        },
        {
          id: 'smsweb-hazard-labels',
          type: 'symbol',
          source: 'hazards',
          minzoom: 12,
          layout: {
            'text-field': ['concat', ['get', 'kind'], ' · ', ['get', 'roadName']],
            'text-font': ['Noto Sans Medium'],
            'text-size': 12,
            'text-offset': [0, 1.4],
            'text-anchor': 'top'
          },
          paint: {
            'text-color': '#9a3412',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
          }
        },
        {
          id: 'smsweb-user-location',
          type: 'circle',
          source: 'userLocation',
          paint: {
            'circle-radius': 8,
            'circle-color': '#0759d7',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3
          }
        }
      ]
    };
  }

  function createMap(container, shelters = [], hazards = []) {
    if (!container || !maplibregl || !pmtiles || !basemaps) {
      return null;
    }

    const packageUrl = new URL('data/dhaka.pmtiles', document.baseURI).href;
    const protocol = new pmtiles.Protocol();
    const archive = new pmtiles.PMTiles(new BundledArchiveSource(packageUrl));
    protocol.add(archive);
    maplibregl.addProtocol('pmtiles', protocol.tile);

    const map = new maplibregl.Map({
      container,
      style: buildStyle(`pmtiles://${ARCHIVE_KEY}`, shelters, hazards),
      center: [90.38, 23.81],
      zoom: 11.2,
      minZoom: 9,
      maxZoom: 17,
      bearing: 0,
      pitch: 0,
      attributionControl: true,
      dragRotate: true,
      touchPitch: true
    });

    map.addControl(new maplibregl.NavigationControl({
      showCompass: true,
      visualizePitch: true
    }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({
      maxWidth: 120,
      unit: 'metric'
    }), 'bottom-left');

    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Offline map did not finish loading'));
      }, 15_000);
      map.once('load', () => {
        clearTimeout(timeout);
        resolve(map);
      });
    });

    return {
      map,
      ready,
      async setShelters(records) {
        const instance = await ready;
        instance.getSource('shelters')?.setData(shelterFeatures(records));
      },
      async setUserLocation(coordinate) {
        const instance = await ready;
        instance.getSource('userLocation')?.setData(pointFeature(coordinate));
      },
      async setHazards(records) {
        const instance = await ready;
        instance.getSource('hazards')?.setData(hazardFeatures(records));
        instance.getSource('hazardAreas')?.setData(hazardAreaFeatures(records));
      },
      async showRoute(route) {
        const instance = await ready;
        instance.getSource('route')?.setData(routeFeature(route));
        if (!route?.coordinates?.length) return;

        const bounds = route.coordinates.reduce(
          (result, coordinate) => result.extend([coordinate.longitude, coordinate.latitude]),
          new maplibregl.LngLatBounds()
        );
        instance.fitBounds(bounds, {
          padding: { top: 80, right: 55, bottom: 80, left: 55 },
          maxZoom: 16,
          duration: 700
        });
      },
      destroy() {
        map.remove();
        maplibregl.removeProtocol('pmtiles');
      }
    };
  }

  return {
    createMap,
    shelterFeatures,
    hazardFeatures,
    hazardAreaFeatures,
    routeFeature,
    pointFeature
  };
});
