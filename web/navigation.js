(function attachNavigation(root, factory) {
  const navigation = factory({
    storage: root?.SMSWeb?.storage,
    renderer: root?.SMSWeb?.renderer,
    geo: root?.SMSWeb?.geo,
    routing: root?.SMSWeb?.routing,
    routeGraph: root?.SMSWeb?.routeGraphs?.mirpur
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = navigation;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.navigation = navigation;
  }
})(typeof window !== 'undefined' ? window : globalThis, (dependencies) => {
  'use strict';

  function createNavigation({ storage, renderer, geo, routing, routeGraph }) {
    let currentPage = 'HOME';

    function bindMapInteractions(appView) {
      if (typeof appView.querySelector !== 'function') return;
      const map = appView.querySelector('.map-data-view');
      const selection = appView.querySelector('#map-selection');
      if (!map || !selection) return;

      const locateButton = appView.querySelector('#map-locate');
      const locationStatus = appView.querySelector('#map-location-status');
      const distanceList = appView.querySelector('#map-distance-list');
      const routeButton = appView.querySelector('#map-route');
      const routeStatus = appView.querySelector('#map-route-status');
      const routeLine = appView.querySelector('#map-route-line');
      let lastOrigin = null;

      function drawRoute(route) {
        if (!routeLine) return;
        const bounds = { minLatitude: 23.70, maxLatitude: 23.90, minLongitude: 90.34, maxLongitude: 90.43 };
        const points = route.coordinates.map((coordinate) => {
          const x = ((coordinate.longitude - bounds.minLongitude) /
            (bounds.maxLongitude - bounds.minLongitude)) * 100;
          const y = ((bounds.maxLatitude - coordinate.latitude) /
            (bounds.maxLatitude - bounds.minLatitude)) * 100;
          return `${x.toFixed(3)},${y.toFixed(3)}`;
        });
        const visible = points.length > 1;
        routeLine.setAttribute('d', visible ? `M ${points.join(' L ')}` : '');
        routeLine.setAttribute('fill', 'none');
        routeLine.setAttribute('stroke', '#0759d7');
        routeLine.setAttribute('stroke-width', '2.4');
        routeLine.setAttribute('stroke-linecap', 'round');
        routeLine.setAttribute('stroke-linejoin', 'round');
        routeLine.setAttribute('vector-effect', 'non-scaling-stroke');
        routeLine.setAttribute('visibility', visible ? 'visible' : 'hidden');
        routeLine.setAttribute('display', visible ? 'inline' : 'none');
        routeLine.classList.toggle('is-visible', visible);
      }

      if (locateButton && locationStatus && distanceList) {
        locateButton.addEventListener('click', () => {
          if (!geo || typeof navigator === 'undefined' || !navigator.geolocation) {
            locationStatus.textContent = 'Location is unavailable on this device.';
            return;
          }

          locateButton.disabled = true;
          locationStatus.textContent = 'Requesting your current location...';
          navigator.geolocation.getCurrentPosition((position) => {
            lastOrigin = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude
            };
            const distances = [...map.querySelectorAll('[data-map-location][data-map-latitude][data-map-longitude]')]
              .map((marker) => ({
                location: marker.dataset.mapLocation,
                spaces: marker.dataset.mapSpaces,
                status: marker.dataset.mapStatus,
                distance: geo.distanceKm(lastOrigin, {
                  latitude: Number(marker.dataset.mapLatitude),
                  longitude: Number(marker.dataset.mapLongitude)
                })
              }))
              .sort((first, second) => first.distance - second.distance);

            distanceList.replaceChildren(...distances.map((record) => {
              const item = document.createElement('li');
              item.textContent = `${record.location}: ${geo.formatDistance(record.distance)} straight-line, ${record.spaces} spaces, ${record.status}.`;
              return item;
            }));
            locationStatus.textContent = 'Distances are straight-line estimates, not road travel distances.';
            locateButton.disabled = false;
          }, (error) => {
            locationStatus.textContent = error.code === 1
              ? 'Location permission was denied.'
              : 'Your current location could not be determined.';
            locateButton.disabled = false;
          }, { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 });
        });
      }

      if (routeButton && routeStatus) {
        routeButton.addEventListener('click', () => {
          if (!lastOrigin) {
            routeStatus.textContent = 'Use my location first so a route can start from your phone.';
            return;
          }
          if (!routing || !routeGraph) {
            routeStatus.textContent = 'No verified offline road graph is installed for this area.';
            return;
          }

          const shelter = [...map.querySelectorAll('[data-map-location][data-map-latitude][data-map-longitude]')]
            .map((marker) => ({
              location: marker.dataset.mapLocation,
              spaces: Number(marker.dataset.mapSpaces),
              status: marker.dataset.mapStatus,
              coordinate: {
                latitude: Number(marker.dataset.mapLatitude),
                longitude: Number(marker.dataset.mapLongitude)
              }
            }))
            .filter((record) => record.status === 'OPEN' && record.spaces > 0)
            .sort((first, second) => geo.distanceKm(lastOrigin, first.coordinate) - geo.distanceKm(lastOrigin, second.coordinate))[0];

          if (!shelter) {
            routeStatus.textContent = 'No open shelter with available spaces was found.';
            return;
          }

          try {
            const route = routing.shortestPath(routeGraph, lastOrigin, shelter.coordinate);
            if (route.originSnap.distanceMeters > 1_500 || route.destinationSnap.distanceMeters > 1_500) {
              routeStatus.textContent = 'Your location or the shelter is outside the bundled Mirpur road coverage.';
              return;
            }
            drawRoute(route);
            routeStatus.textContent = `Route to ${shelter.location}: ${geo.formatDistance(route.distanceMeters / 1000)} on mapped roads. Coverage is currently limited to Mirpur.`;
          } catch (error) {
            routeStatus.textContent = error.message;
          }
        });
      }

      map.addEventListener('click', (event) => {
        const marker = event.target.closest('[data-map-location]');
        if (!marker) return;

        selection.textContent = `${marker.dataset.mapLocation}: ${marker.dataset.mapSpaces} spaces, ${marker.dataset.mapStatus}.`;
      });
    }

    async function show(page, appView) {
      currentPage = page;

      try {
        if (page === 'HOME') {
          renderer.mount(appView, renderer.renderHomePage({
            title: 'Welcome to SMSWeb',
            message: 'Choose a local information page to get started.'
          }));
          return;
        }

        if (page === 'SHELTER') {
          const record = await storage.getPage('SHELTER:DHK');
          renderer.mount(appView, renderer.renderShelterPage(record || {
            title: 'Emergency Shelters',
            region: 'DHK',
            payload: ''
          }));
          return;
        }

        if (page === 'ALERTS') {
          const alerts = await storage.getActiveAlerts();
          renderer.mount(appView, renderer.renderAlertsPage(alerts));
          return;
        }

        if (page === 'MAP') {
          const record = typeof storage?.getPage === 'function'
            ? await storage.getPage('SHELTER:DHK')
            : null;
          renderer.mount(appView, renderer.renderMapPage(record || {
            title: 'Crisis map',
            region: 'DHK',
            payload: ''
          }));
          bindMapInteractions(appView);
          return;
        }

        if (page === 'ACTIVITY') {
          const messages = typeof storage?.getRecentMessages === 'function'
            ? await storage.getRecentMessages()
            : [];
          renderer.mount(appView, renderer.renderActivityPage(messages));
          return;
        }

        throw new Error(`Unsupported navigation page: ${page}`);
      } catch (error) {
        renderer.mount(appView, `<article class="page-view error-view">
          <p class="eyebrow">Unable to load page</p>
          <h2>${renderer.escapeHtml(error.message)}</h2>
          <p>Previously received information may still be available after the local database is restored.</p>
        </article>`);
      }
    }

    async function refresh(appView) {
      return show(currentPage, appView);
    }

    function initialize({ nav, appView }) {
      if (!nav || !appView) {
        throw new Error('Navigation controls are unavailable');
      }

      nav.addEventListener('click', (event) => {
        const button = event.target.closest('[data-page]');
        if (!button) return;

        nav.querySelectorAll('[data-page]').forEach((item) => {
          item.setAttribute('aria-current', item === button ? 'page' : 'false');
        });
        void show(button.dataset.page, appView);
      });

      void show('HOME', appView);
    }

    return { initialize, show, refresh };
  }

  return Object.assign(createNavigation(dependencies), { createNavigation });
});
