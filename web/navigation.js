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

    function bindMapInteractions(appView) {
      if (typeof appView.querySelector !== 'function') return;
      const map = appView.querySelector('.map-data-view');
      const selection = appView.querySelector('#map-selection');
      if (!map || !selection) return;

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
