(function attachDemo(root, factory) {
  const api = factory(root?.fetch?.bind(root));

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.demo = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, (fetchApi) => {
  'use strict';

  async function available() {
    if (!fetchApi) return false;
    try {
      const response = await fetchApi('./demo/scenario', { method: 'GET' });
      return response.ok;
    } catch (_error) {
      return false;
    }
  }

  function initialize({ container, button, status, simulator, navigation, appView } = {}) {
    if (!container || !button || !status || !simulator || !navigation || !fetchApi) return;
    void available().then((enabled) => { container.hidden = !enabled; });

    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Loading signed local demonstration messages...';
      try {
        const response = await fetchApi('./demo/scenario');
        const scenario = await response.json();
        if (!response.ok) throw new Error(scenario.error || 'Demo service is unavailable.');
        for (const message of scenario.messages || []) {
          await simulator.handleSms(
            message,
            appView,
            Date.now(),
            'local-judge-demo',
            'AUTHENTICATED'
          );
        }
        navigation.setDemoLocation?.(scenario.location);
        await navigation.show('MAP', appView);
        status.textContent =
          'Scenario loaded. The map now shows signed demo shelters and hazards; select Find route.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  }

  return { initialize, available };
});
