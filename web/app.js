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
    badgeElement: document.querySelector('#gateway-connection-badge')
  });

  const navigation = window.SMSWeb.navigation;
  navigation.initialize({
    nav: document.querySelector('#app-nav'),
    appView
  });

  window.SMSWeb.simulator.initialize({
    input: document.querySelector('#sms-input'),
    button: document.querySelector('#parse-sms'),
    status: document.querySelector('#simulator-status'),
    appView
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app remains usable without caching when service workers are unavailable.
    });
  }
})();
