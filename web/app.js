(() => {
  const statusMessage = document.querySelector('#status-message');
  const appView = document.querySelector('#app-view');

  if (!statusMessage || !appView || !window.SMSWeb?.renderer) {
    return;
  }

  statusMessage.textContent = 'The local application shell is loaded and ready.';

  async function start() {
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
    callShelterButton: document.querySelector('#call-shelter'),
    callAlertButton: document.querySelector('#call-alert'),
    callHazardButton: document.querySelector('#call-hazard'),
    callStatusElement: document.querySelector('#call-status'),
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

    const previewRole = new URLSearchParams(window.location.search).get('role');
    const appRole = !window.smsWeb && String(previewRole).toUpperCase() === 'USER'
      ? 'USER'
      : window.SMSWeb.gateway.getAppRole?.() || 'USER';
    document.body.dataset.appRole = appRole;
    if (appRole === 'USER') {
      const userHeader = document.querySelector('#user-app-header');
      const userQuickPanel = document.querySelector('#user-quick-panel');
      const userRequestActions = document.querySelector('#user-request-actions');
      const requestActions = document.querySelector('.request-actions');
      if (userHeader) userHeader.hidden = false;
      if (userQuickPanel) userQuickPanel.hidden = false;
      if (userRequestActions && requestActions) {
        userRequestActions.append(requestActions);
        const residentLabels = [
          ['#request-shelters', 'Get shelters'],
          ['#request-alerts', 'Get alerts'],
          ['#request-hazards', 'Get hazards'],
          ['#call-shelter', 'Call for shelters'],
          ['#call-alert', 'Call for alerts'],
          ['#call-hazard', 'Call for hazards']
        ];
        residentLabels.forEach(([selector, label]) => {
          const button = requestActions.querySelector(selector);
          if (button) {
            button.textContent = label;
            button.setAttribute('aria-label', label);
          }
        });
      }

      await window.SMSWeb.storage.purgeLegacyBundledDemoData?.();
    }

    window.SMSWeb.admin?.initialize({
    container: document.querySelector('#authority-console'),
    keyInput: document.querySelector('#authority-key'),
    status: document.querySelector('#authority-status')
    });

    const navigation = window.SMSWeb.navigation;
    navigation.initialize({
    nav: document.querySelector('#app-nav'),
    appView,
      gateway: window.SMSWeb.gateway,
      initialPage: appRole === 'USER' ? 'MAP' : 'HOME'
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
      await navigation.refresh(appView);
      statusMessage.textContent = result;
      const requestStatus = document.querySelector('#request-status');
      if (requestStatus && appRole === 'USER') {
        requestStatus.textContent =
          `Authenticated SMS received. ${result} The offline screens have been updated.`;
      }
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
  }

  void start().catch((error) => {
    statusMessage.textContent = `Application startup failed: ${error.message}`;
    window.SMSWeb.renderer.mount(appView, `<article class="page-view error-view">
      <p class="eyebrow">Unable to start</p>
      <h2>${window.SMSWeb.renderer.escapeHtml(error.message)}</h2>
      <p>Restart the app. Previously received offline information has not been deleted.</p>
    </article>`);
  });
})();
