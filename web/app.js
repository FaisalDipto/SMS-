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
    requestAlertsButton: document.querySelector('#request-alerts'),
    requestHazardsButton: document.querySelector('#request-hazards'),
    requestStatusElement: document.querySelector('#request-status'),
    authenticationKeyInput: document.querySelector('#authentication-key'),
    saveAuthenticationKeyButton: document.querySelector('#save-authentication-key'),
    authenticationStatusElement: document.querySelector('#authentication-status'),
    authenticationBadgeElement: document.querySelector('#authentication-badge'),
    authenticationKeyControls: document.querySelector('#authentication-key-controls'),
    replaceAuthenticationKeyButton: document.querySelector('#replace-authentication-key'),
    administratorSetup: document.querySelector('#administrator-setup'),
    roleSelect: document.querySelector('#app-role'),
    roleSelector: document.querySelector('#role-selector'),
    saveRoleButton: document.querySelector('#save-app-role'),
    roleDescription: document.querySelector('#app-role-description'),
    roleRoot: document.body,
    gatewayEyebrow: document.querySelector('#gateway-eyebrow'),
    gatewayTitle: document.querySelector('#gateway-title'),
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

  window.SMSWeb.admin?.initialize({
    container: document.querySelector('#authority-console'),
    keyInput: document.querySelector('#authority-key'),
    status: document.querySelector('#authority-status')
  });

  const navigation = window.SMSWeb.navigation;
  navigation.initialize({
    nav: document.querySelector('#app-nav'),
    appView,
    gateway: window.SMSWeb.gateway
  });

  const simulator = window.SMSWeb.simulator;
  simulator.initialize({
    input: document.querySelector('#sms-input'),
    button: document.querySelector('#parse-sms'),
    status: document.querySelector('#simulator-status'),
    appView
  });

  window.SMSWeb.demo?.initialize({
    container: document.querySelector('#judge-demo'),
    button: document.querySelector('#run-judge-demo'),
    status: document.querySelector('#judge-demo-status'),
    simulator,
    navigation,
    appView
  });

  window.SMSWeb.gateway.setIncomingHandler(async (rawText, authentication) => {
    try {
      const result = await simulator.handleSms(
        rawText,
        appView,
        Date.now(),
        'android-gateway',
        authentication
      );
      statusMessage.textContent = result;
      window.smsWeb?.acknowledgeResponse?.(rawText);
    } catch (error) {
      statusMessage.textContent = `Received SMS could not be rendered: ${error.message}`;
    }
  });

  void window.SMSWeb.gateway.replayPendingResponses();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app remains usable without caching when service workers are unavailable.
    });
  }
})();
