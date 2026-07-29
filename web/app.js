(() => {
  const statusMessage = document.querySelector('#status-message');
  const appView = document.querySelector('#app-view');

  if (!statusMessage || !appView || !window.SMSWeb?.renderer) {
    return;
  }

  statusMessage.textContent = 'The local application shell is loaded and ready.';

  window.SMSWeb.gateway.initialize({
    urlInput: document.querySelector('#pi-url'),
    saveButton: document.querySelector('#save-pi-url'),
    checkButton: document.querySelector('#check-pi-connection'),
    statusElement: document.querySelector('#gateway-status'),
    badgeElement: document.querySelector('#gateway-connection-badge'),
    serviceNumber: document.querySelector('#service-number'),
    saveServiceNumberButton: document.querySelector('#save-service-number'),
    requestSheltersButton: document.querySelector('#request-shelters'),
    requestStatusElement: document.querySelector('#request-status'),
    onRequest: async (request) => {
      await window.SMSWeb.storage.saveMessage({
        requestId: request.requestId,
        direction: 'outgoing',
        rawText: request.rawText,
        status: 'queued',
        source: 'android-dashboard'
      });
    }
  });

  const navigation = window.SMSWeb.navigation;
  navigation.initialize({
    nav: document.querySelector('#app-nav'),
    appView
  });

  const simulator = window.SMSWeb.simulator;
  simulator.initialize({
    input: document.querySelector('#sms-input'),
    button: document.querySelector('#parse-sms'),
    status: document.querySelector('#simulator-status'),
    appView
  });

  window.SMSWeb.gateway.setIncomingHandler(async (rawText) => {
    try {
      const result = await simulator.handleSms(rawText, appView, Date.now(), 'android-gateway');
      statusMessage.textContent = result;
    } catch (error) {
      statusMessage.textContent = `Received SMS could not be rendered: ${error.message}`;
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app remains usable without caching when service workers are unavailable.
    });
  }
})();
