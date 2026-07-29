(function attachSimulator(root, factory) {
  const simulator = factory({
    protocol: root?.SMSWeb?.protocol,
    storage: root?.SMSWeb?.storage,
    renderer: root?.SMSWeb?.renderer
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = simulator;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.simulator = simulator;
  }
})(typeof window !== 'undefined' ? window : globalThis, (dependencies) => {
  'use strict';

  function createSimulator({ protocol, storage, renderer }) {
    async function handleSms(rawText, appView, now = Date.now()) {
      if (typeof rawText !== 'string' || rawText.trim() === '') {
        throw new Error('Paste an SMS message before parsing');
      }

      if (!appView) {
        throw new Error('The application view is unavailable');
      }

      const messageType = rawText.trim().split('|', 1)[0];

      if (messageType === 'RES') {
        const response = protocol.parseResponse(rawText);

        await storage.saveMessage({
          requestId: response.requestId,
          direction: 'incoming',
          rawText,
          status: 'received',
          createdAt: now
        });

        if (response.page !== 'SHELTER') {
          throw new Error(`Simulator rendering is not implemented for ${response.page} yet`);
        }

        const page = {
          pageId: `${response.page}:${response.region}`,
          title: 'Emergency Shelters',
          region: response.region,
          payload: response.payload,
          content: response.payload,
          receivedAt: now,
          source: 'simulator'
        };

        await storage.savePage(page);
        renderer.mount(appView, renderer.renderShelterPage(page, now));

        return `Rendered ${response.page} response for ${response.region}`;
      }

      if (messageType === 'ALT') {
        const alert = protocol.parseAlert(rawText);
        const record = {
          ...alert,
          expiresAt: alert.expires * 1_000,
          receivedAt: now,
          source: 'simulator'
        };

        await storage.saveMessage({
          requestId: alert.alertId,
          direction: 'incoming',
          rawText,
          status: 'received',
          createdAt: now
        });
        await storage.saveAlert(record);
        renderer.mount(appView, renderer.renderAlertsPage([record], now));

        return `Rendered ${alert.priority} alert for ${alert.region}`;
      }

      throw new Error(`Unsupported simulator message type: ${messageType}`);
    }

    function initialize({ input, button, status, appView }) {
      if (!input || !button || !status || !appView) {
        throw new Error('Simulator controls are unavailable');
      }

      button.addEventListener('click', async () => {
        status.dataset.state = 'working';
        status.textContent = 'Parsing SMS...';

        try {
          status.textContent = await handleSms(input.value, appView);
          status.dataset.state = 'success';
        } catch (error) {
          status.textContent = error.message;
          status.dataset.state = 'error';
        }
      });
    }

    return { handleSms, initialize };
  }

  return Object.assign(createSimulator(dependencies), { createSimulator });
});
