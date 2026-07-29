(function attachNavigation(root, factory) {
  const navigation = factory({
    storage: root?.SMSWeb?.storage,
    renderer: root?.SMSWeb?.renderer
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

  function createNavigation({ storage, renderer }) {
    let currentPage = 'HOME';

    function renderMapPlaceholder(appView) {
      renderer.mount(appView, `<article class="page-view page-view-map">
        <header class="page-view-header">
          <div>
            <p class="eyebrow">Offline map</p>
            <h2>Crisis map</h2>
          </div>
          <span class="freshness freshness-unknown">Map package not installed</span>
        </header>
        <div class="map-placeholder" role="img" aria-label="Offline map coming soon">
          <div class="map-grid" aria-hidden="true"></div>
          <div class="map-pin map-pin-one" aria-hidden="true"></div>
          <div class="map-pin map-pin-two" aria-hidden="true"></div>
          <p>Offline shelter and hazard markers will appear here when a regional map package is added.</p>
        </div>
      </article>`);
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
          renderMapPlaceholder(appView);
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
