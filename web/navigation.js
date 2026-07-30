(function attachNavigation(root, factory) {
  const navigation = factory({
    storage: root?.SMSWeb?.storage,
    renderer: root?.SMSWeb?.renderer,
    geo: root?.SMSWeb?.geo,
    routing: root?.SMSWeb?.routing,
    routeGraph: root?.SMSWeb?.routeGraphs?.mirpur,
    offlineMap: root?.SMSWeb?.offlineMap,
    nativeBridge: root?.smsWeb
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

  function createNavigation({ storage, renderer, geo, routing, routeGraph, offlineMap, nativeBridge }) {
    let currentPage = 'HOME';
    let currentDetailedMap = null;
    let pendingNativeLocation = null;
    let gatewayApi = null;
    let demoLocation = null;

    function receiveNativeLocation(latitude, longitude, accuracy) {
      if (!pendingNativeLocation) return;
      const callback = pendingNativeLocation;
      pendingNativeLocation = null;
      callback.success({
        coords: {
          latitude: Number(latitude),
          longitude: Number(longitude),
          accuracy: Number(accuracy)
        }
      });
    }

    function receiveNativeLocationError(message) {
      if (!pendingNativeLocation) return;
      const callback = pendingNativeLocation;
      pendingNativeLocation = null;
      callback.error({ code: 2, message: String(message || 'Current location is unavailable.') });
    }

    function requestDeviceLocation(success, error) {
      if (nativeBridge && typeof nativeBridge.requestCurrentLocation === 'function') {
        pendingNativeLocation = { success, error };
        try {
          nativeBridge.requestCurrentLocation();
        } catch (bridgeError) {
          pendingNativeLocation = null;
          error({ code: 2, message: bridgeError.message });
        }
        return;
      }

      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        error({ code: 2, message: 'Location is unavailable on this device.' });
        return;
      }

      navigator.geolocation.getCurrentPosition(success, error, {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 20_000
      });
    }

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
      const routeLocation = appView.querySelector('#map-route-location');
      const routeRoads = appView.querySelector('#map-route-roads');
      const detailedMapContainer = appView.querySelector('#offline-vector-map');
      const legacyMap = appView.querySelector('#map-legacy-layer');
      const mapDataNote = appView.querySelector('#map-data-note');
      const roadLabels = appView.querySelector('#map-road-labels');
      const viewport = appView.querySelector('#map-viewport');
      const routeLine = appView.querySelector('#map-route-line');
      const userLocation = appView.querySelector('#map-user-location');
      const offlineRoads = appView.querySelector('#map-offline-roads');
      const fullMapBounds = { minLatitude: 23.70, maxLatitude: 23.90, minLongitude: 90.34, maxLongitude: 90.43 };
      let mapBounds = { ...fullMapBounds };
      let lastOrigin = demoLocation;
      const shelterRecords = [...map.querySelectorAll('[data-map-location][data-map-latitude][data-map-longitude]')]
        .map((marker) => ({
          location: marker.dataset.mapLocation,
          spaces: Number(marker.dataset.mapSpaces),
          status: marker.dataset.mapStatus,
          coordinates: {
            latitude: Number(marker.dataset.mapLatitude),
            longitude: Number(marker.dataset.mapLongitude)
          }
        }));
      const hazardRecords = [...map.querySelectorAll(
        '[data-map-hazard][data-map-hazard-latitude][data-map-hazard-longitude]'
      )].map((marker) => ({
        hazardId: marker.dataset.mapHazard,
        kind: marker.dataset.mapHazardKind,
        roadName: marker.dataset.mapHazardRoad,
        severity: marker.dataset.mapHazardSeverity,
        radiusMeters: Number(marker.dataset.mapHazardRadius),
        latitude: Number(marker.dataset.mapHazardLatitude),
        longitude: Number(marker.dataset.mapHazardLongitude),
        expiresAt: Number(marker.dataset.mapHazardExpires),
        authentication: marker.dataset.mapHazardAuthentication
      }));
      const blockingHazards = hazardRecords.filter((hazard) =>
        String(hazard.authentication).toUpperCase() === 'AUTHENTICATED' &&
        hazard.expiresAt > Date.now()
      );
      const detailedMap = offlineMap?.createMap(
        detailedMapContainer,
        shelterRecords,
        hazardRecords
      );
      currentDetailedMap = detailedMap;

      if (detailedMap) {
        detailedMap.ready.then((instance) => {
          legacyMap?.classList.add('is-hidden');
          detailedMapContainer?.classList.add('is-ready');
          if (mapDataNote) {
            mapDataNote.textContent = 'Offline vector basemap covers greater Dhaka through zoom level 15. Routing currently follows the separate Mirpur road graph.';
          }
          instance.on('click', 'smsweb-shelters', (event) => {
            const properties = event.features?.[0]?.properties;
            if (!properties) return;
            selection.textContent = `${properties.location}: ${properties.spaces} spaces, ${properties.status}.`;
          });
          instance.on('mouseenter', 'smsweb-shelters', () => {
            instance.getCanvas().style.cursor = 'pointer';
          });
          instance.on('mouseleave', 'smsweb-shelters', () => {
            instance.getCanvas().style.cursor = '';
          });
          instance.on('click', 'smsweb-hazards', (event) => {
            const properties = event.features?.[0]?.properties;
            if (!properties) return;
            selection.textContent =
              `${properties.severity} ${String(properties.kind).replaceAll('_', ' ')} on ${properties.roadName}. Routes avoid the marked zone.`;
          });
          instance.on('mouseenter', 'smsweb-hazards', () => {
            instance.getCanvas().style.cursor = 'pointer';
          });
          instance.on('mouseleave', 'smsweb-hazards', () => {
            instance.getCanvas().style.cursor = '';
          });
        }).catch((error) => {
          if (mapDataNote) {
            mapDataNote.textContent = `Detailed offline map unavailable: ${error.message}. The route-graph fallback remains available.`;
          }
        });
      }

      function setupMapControls() {
        if (!viewport) return;
        const view = { scale: 1, rotation: 0, x: 0, y: 0 };
        const applyView = () => {
          viewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.rotation}deg)`;
        };
        const zoom = (amount) => {
          view.scale = Math.min(3, Math.max(0.75, view.scale + amount));
          applyView();
        };
        const rotate = (amount) => {
          view.rotation = (view.rotation + amount + 360) % 360;
          applyView();
        };

        appView.querySelector('#map-zoom-in')?.addEventListener('click', () => zoom(0.25));
        appView.querySelector('#map-zoom-out')?.addEventListener('click', () => zoom(-0.25));
        appView.querySelector('#map-rotate-left')?.addEventListener('click', () => rotate(-15));
        appView.querySelector('#map-rotate-right')?.addEventListener('click', () => rotate(15));
        appView.querySelector('#map-reset-view')?.addEventListener('click', () => {
          view.scale = 1;
          view.rotation = 0;
          view.x = 0;
          view.y = 0;
          applyView();
        });

        let drag;
        viewport.addEventListener('pointerdown', (event) => {
          if (event.target.closest('[data-map-location]')) return;
          drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          viewport.setPointerCapture(event.pointerId);
        });
        viewport.addEventListener('pointermove', (event) => {
          if (!drag || drag.pointerId !== event.pointerId) return;
          view.x += event.clientX - drag.x;
          view.y += event.clientY - drag.y;
          drag.x = event.clientX;
          drag.y = event.clientY;
          applyView();
        });
        viewport.addEventListener('pointerup', () => { drag = null; });
        viewport.addEventListener('pointercancel', () => { drag = null; });
        map.addEventListener('wheel', (event) => {
          event.preventDefault();
          zoom(event.deltaY < 0 ? 0.15 : -0.15);
        }, { passive: false });
        applyView();
      }

      setupMapControls();

      function project(coordinate, bounds = mapBounds) {
        const x = ((coordinate.longitude - bounds.minLongitude) /
          (bounds.maxLongitude - bounds.minLongitude)) * 100;
        const y = ((bounds.maxLatitude - coordinate.latitude) /
          (bounds.maxLatitude - bounds.minLatitude)) * 100;
        return `${x.toFixed(3)},${y.toFixed(3)}`;
      }

      function graphBounds(graph) {
        const nodes = Object.values(graph?.nodes || {});
        if (nodes.length === 0) return fullMapBounds;
        const latitudes = nodes.map((node) => node.latitude);
        const longitudes = nodes.map((node) => node.longitude);
        const minLatitude = Math.min(...latitudes);
        const maxLatitude = Math.max(...latitudes);
        const minLongitude = Math.min(...longitudes);
        const maxLongitude = Math.max(...longitudes);
        const latitudePadding = Math.max((maxLatitude - minLatitude) * 0.08, 0.001);
        const longitudePadding = Math.max((maxLongitude - minLongitude) * 0.08, 0.001);
        return {
          minLatitude: minLatitude - latitudePadding,
          maxLatitude: maxLatitude + latitudePadding,
          minLongitude: minLongitude - longitudePadding,
          maxLongitude: maxLongitude + longitudePadding
        };
      }

      function routeBounds(route) {
        const latitudes = route.coordinates.map((coordinate) => coordinate.latitude);
        const longitudes = route.coordinates.map((coordinate) => coordinate.longitude);
        const minLatitude = Math.min(...latitudes);
        const maxLatitude = Math.max(...latitudes);
        const minLongitude = Math.min(...longitudes);
        const maxLongitude = Math.max(...longitudes);
        const latitudePadding = Math.max((maxLatitude - minLatitude) * 0.18, 0.0015);
        const longitudePadding = Math.max((maxLongitude - minLongitude) * 0.18, 0.0015);
        return {
          minLatitude: minLatitude - latitudePadding,
          maxLatitude: maxLatitude + latitudePadding,
          minLongitude: minLongitude - longitudePadding,
          maxLongitude: maxLongitude + longitudePadding
        };
      }

      function positionMarkers() {
        map.querySelectorAll('[data-map-location][data-map-latitude][data-map-longitude]')
          .forEach((marker) => {
            const latitude = Number(marker.dataset.mapLatitude);
            const longitude = Number(marker.dataset.mapLongitude);
            const inside = latitude >= mapBounds.minLatitude && latitude <= mapBounds.maxLatitude &&
              longitude >= mapBounds.minLongitude && longitude <= mapBounds.maxLongitude;
            marker.style.display = inside ? '' : 'none';
            if (inside) {
              const [left, top] = project({ latitude, longitude }).split(',');
              marker.style.left = `${left}%`;
              marker.style.top = `${top}%`;
            }
          });
        map.querySelectorAll(
          '[data-map-hazard][data-map-hazard-latitude][data-map-hazard-longitude]'
        ).forEach((marker) => {
          const latitude = Number(marker.dataset.mapHazardLatitude);
          const longitude = Number(marker.dataset.mapHazardLongitude);
          const inside = latitude >= mapBounds.minLatitude && latitude <= mapBounds.maxLatitude &&
            longitude >= mapBounds.minLongitude && longitude <= mapBounds.maxLongitude;
          marker.style.display = inside ? '' : 'none';
          if (inside) {
            const [left, top] = project({ latitude, longitude }).split(',');
            marker.style.left = `${left}%`;
            marker.style.top = `${top}%`;
          }
        });
      }

      function drawOfflineRoads(graph, bounds = mapBounds) {
        if (!offlineRoads || !graph?.nodes || !graph?.edges) return;

        const commands = [];

        for (const [fromId, edges] of Object.entries(graph.edges)) {
          const from = graph.nodes[fromId];
          if (!from || !Array.isArray(edges)) continue;
          for (const edge of edges) {
            const to = graph.nodes[edge.to];
            if (!to) continue;
            commands.push(`M ${project(from, bounds)} L ${project(to, bounds)}`);
          }
        }

        offlineRoads.setAttribute('d', commands.join(' '));
        map.classList.add('has-offline-road-graph');
      }

      drawOfflineRoads(routeGraph);
      drawRoadLabels(graphRoadEdges(routeGraph), 20);

      function drawRoute(route) {
        if (!routeLine) return;
        const points = route.coordinates.map((coordinate) => project(coordinate));
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

        if (userLocation) {
          const [cx, cy] = project(route.coordinates[0]).split(',');
          userLocation.setAttribute('cx', cx);
          userLocation.setAttribute('cy', cy);
          userLocation.classList.toggle('is-visible', visible);
        }
      }

      function graphRoadEdges(graph) {
        const edges = [];
        for (const [from, outgoing] of Object.entries(graph?.edges || {})) {
          for (const edge of outgoing || []) edges.push({ ...edge, from });
        }
        return edges;
      }

      function drawRoadLabels(edges, limit = 8) {
        if (!roadLabels || typeof document === 'undefined') return;
        roadLabels.replaceChildren();
        const candidates = new Map();

        for (const edge of edges || []) {
          if (!edge.roadName || !routeGraph.nodes[edge.from] || !routeGraph.nodes[edge.to]) continue;
          const existing = candidates.get(edge.roadName);
          if (!existing || (edge.distanceMeters || 0) > existing.distanceMeters) {
            const from = routeGraph.nodes[edge.from];
            const to = routeGraph.nodes[edge.to];
            candidates.set(edge.roadName, {
              distanceMeters: edge.distanceMeters || 0,
              latitude: (from.latitude + to.latitude) / 2,
              longitude: (from.longitude + to.longitude) / 2
            });
          }
        }

        [...candidates.entries()]
          .sort((first, second) => second[1].distanceMeters - first[1].distanceMeters)
          .slice(0, limit)
          .forEach(([name, coordinate]) => {
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          const [x, y] = project(coordinate).split(',');
          label.setAttribute('x', x);
          label.setAttribute('y', y);
          label.setAttribute('class', 'map-road-label');
          label.textContent = name;
          roadLabels.appendChild(label);
          });
      }

      function applyLocation(position, demonstration = false) {
        lastOrigin = {
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude)
        };
        const distances = [...map.querySelectorAll(
          '[data-map-location][data-map-latitude][data-map-longitude]'
        )].map((marker) => ({
          location: marker.dataset.mapLocation,
          spaces: marker.dataset.mapSpaces,
          status: marker.dataset.mapStatus,
          distance: geo.distanceKm(lastOrigin, {
            latitude: Number(marker.dataset.mapLatitude),
            longitude: Number(marker.dataset.mapLongitude)
          })
        })).sort((first, second) => first.distance - second.distance);

        distanceList?.replaceChildren(...distances.map((record) => {
          const item = document.createElement('li');
          item.textContent = `${record.location}: ${geo.formatDistance(record.distance)} straight-line, ${record.spaces} spaces, ${record.status}.`;
          return item;
        }));
        if (locationStatus) {
          locationStatus.textContent = demonstration
            ? 'Judge demo location near Mirpur is active. Distances are straight-line estimates.'
            : 'Distances are straight-line estimates, not road travel distances.';
        }
        void detailedMap?.setUserLocation(lastOrigin);
        if (locateButton) locateButton.disabled = false;
      }

      if (demoLocation && geo) {
        applyLocation({
          coords: {
            latitude: demoLocation.latitude,
            longitude: demoLocation.longitude
          }
        }, true);
      }

      if (locateButton && locationStatus && distanceList) {
        locateButton.addEventListener('click', () => {
          if (!geo) {
            locationStatus.textContent = 'Location is unavailable on this device.';
            return;
          }

          locateButton.disabled = true;
          locationStatus.textContent = 'Requesting your current location...';
          requestDeviceLocation((position) => {
            demoLocation = null;
            applyLocation(position);
          }, (error) => {
            locationStatus.textContent = error.code === 1
              ? 'Location permission was denied.'
              : error.message || 'Your current location could not be determined.';
            locateButton.disabled = false;
          });
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
            const baselineRoute = routing.shortestPath(
              routeGraph,
              lastOrigin,
              shelter.coordinate
            );
            const blockedEdges = routing.blockedEdgesForHazards(
              routeGraph,
              hazardRecords,
              Date.now()
            );
            const route = routing.shortestPath(
              routeGraph,
              lastOrigin,
              shelter.coordinate,
              { blockedEdges }
            );
            if (route.originSnap.distanceMeters > 1_500 || route.destinationSnap.distanceMeters > 1_500) {
              routeStatus.textContent = 'Your location or the shelter is outside the bundled Mirpur road coverage.';
              return;
            }
            mapBounds = routeBounds(route);
            drawOfflineRoads(routeGraph, mapBounds);
            positionMarkers();
            map.classList.add('is-route-focused');
            drawRoute(route);
            void detailedMap?.showRoute(route);
            drawRoadLabels(route.edges, 8);
            if (routeLocation) {
              routeLocation.textContent = `Your location: ${lastOrigin.latitude.toFixed(5)}, ${lastOrigin.longitude.toFixed(5)}. Destination: ${shelter.location}.`;
            }
            if (routeRoads) {
              const roadNames = route.roadNames?.length > 0 ? route.roadNames : ['Unnamed mapped road'];
              routeRoads.replaceChildren(...roadNames.map((roadName) => {
                const item = document.createElement('li');
                item.textContent = roadName;
                return item;
              }));
            }
            const detourMeters = Math.max(0, route.distanceMeters - baselineRoute.distanceMeters);
            const hazardMessage = blockedEdges.size > 0
              ? ` Avoiding ${blockedEdges.size} road segment${blockedEdges.size === 1 ? '' : 's'} affected by ${blockingHazards.length} authenticated hazard${blockingHazards.length === 1 ? '' : 's'}${detourMeters >= 10 ? `; safety detour adds ${geo.formatDistance(detourMeters / 1000)}` : ''}.`
              : ' No authenticated hazard intersects this route.';
            routeStatus.textContent = `Route to ${shelter.location}: ${geo.formatDistance(route.distanceMeters / 1000)} on mapped roads.${hazardMessage}`;
          } catch (error) {
            routeStatus.textContent = blockingHazards.length > 0
              ? `${error.message}. Current authenticated hazard zones may disconnect the available road graph.`
              : error.message;
          }
        });
      }

      map.addEventListener('click', (event) => {
        const hazard = event.target.closest('[data-map-hazard]');
        if (hazard) {
          selection.textContent =
            `${hazard.dataset.mapHazardSeverity} ${hazard.dataset.mapHazardKind.replaceAll('_', ' ')} on ${hazard.dataset.mapHazardRoad}. Routes avoid a ${hazard.dataset.mapHazardRadius} m zone.`;
          return;
        }
        const marker = event.target.closest('[data-map-location]');
        if (!marker) return;

        selection.textContent = `${marker.dataset.mapLocation}: ${marker.dataset.mapSpaces} spaces, ${marker.dataset.mapStatus}.`;
      });
    }

    async function show(page, appView) {
      currentDetailedMap?.destroy();
      currentDetailedMap = null;
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

        if (page === 'HAZARDS') {
          const hazards = typeof storage?.getActiveHazards === 'function'
            ? await storage.getActiveHazards()
            : [];
          renderer.mount(appView, renderer.renderHazardsPage(hazards));
          return;
        }

        if (page === 'MAP') {
          const record = typeof storage?.getPage === 'function'
            ? await storage.getPage('SHELTER:DHK')
            : null;
          const hazards = typeof storage?.getActiveHazards === 'function'
            ? await storage.getActiveHazards()
            : [];
          const mapRecord = record || {
            title: 'Crisis map',
            region: 'DHK',
            payload: ''
          };
          renderer.mount(appView, renderer.renderMapPage({ ...mapRecord, hazards }));
          bindMapInteractions(appView);
          return;
        }

        if (page === 'ACTIVITY') {
          const messages = typeof storage?.getRecentMessages === 'function'
            ? await storage.getRecentMessages()
            : [];
          const gatewayEvents = gatewayApi?.getActivity?.() || [];
          const combined = [...gatewayEvents, ...messages]
            .sort((first, second) =>
              Number(second.createdAt || 0) - Number(first.createdAt || 0)
            )
            .slice(0, 50);
          renderer.mount(appView, renderer.renderActivityPage(combined));
          const retryButton = appView.querySelector?.('#activity-retry');
          const retryStatus = appView.querySelector?.('#activity-retry-status');
          if (retryButton) {
            retryButton.disabled = !gatewayApi?.canRetryQueuedMessages?.();
            retryButton.addEventListener('click', () => {
              const result = gatewayApi?.retryQueuedMessages?.();
              retryStatus.textContent = result === 'queued'
                ? 'Immediate retry requested. Refresh Activity in a few seconds to see the result.'
                : 'Retry controls are available in the Android gateway.';
            });
          }
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

    function setDemoLocation(location) {
      const latitude = Number(location?.latitude);
      const longitude = Number(location?.longitude);
      demoLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { latitude, longitude }
        : null;
    }

    function initialize({ nav, appView, gateway }) {
      if (!nav || !appView) {
        throw new Error('Navigation controls are unavailable');
      }
      gatewayApi = gateway || null;

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

    return {
      initialize,
      show,
      refresh,
      setDemoLocation,
      receiveNativeLocation,
      receiveNativeLocationError
    };
  }

  return Object.assign(createNavigation(dependencies), { createNavigation });
});
