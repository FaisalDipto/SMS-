(function attachGateway(root, factory) {
  const gateway = factory(root?.smsWeb || null);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = gateway;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.gateway = gateway;
  }
})(typeof window !== 'undefined' ? window : globalThis, (nativeBridge) => {
  'use strict';

  function createGateway(bridge) {
    let badge;
    let status;

    function setConnectionState(connected) {
      if (!badge || !status) return;

      badge.className = `connection-badge ${connected ? 'connection-online' : 'connection-offline'}`;
      badge.textContent = connected ? 'Connected' : 'Unavailable';
      status.textContent = connected
        ? 'The Raspberry Pi service is reachable on the local network.'
        : 'The Raspberry Pi service could not be reached. Queued SMS messages will retry.';
    }

    function initialize({ urlInput, saveButton, checkButton, statusElement, badgeElement }) {
      badge = badgeElement;
      status = statusElement;

      if (!urlInput || !saveButton || !checkButton || !status || !badge) {
        return;
      }

      if (!bridge || typeof bridge.getPiUrl !== 'function') {
        status.textContent = 'Native gateway controls are available in the Android app.';
        saveButton.disabled = true;
        checkButton.disabled = true;
        return;
      }

      urlInput.value = bridge.getPiUrl() || '';
      status.textContent = 'Pi URL loaded. Check the connection when the service is running.';

      saveButton.addEventListener('click', () => {
        const savedUrl = bridge.savePiUrl(urlInput.value);
        urlInput.value = savedUrl || urlInput.value.trim();
        status.textContent = savedUrl ? 'Pi URL saved on this phone.' : 'Enter a valid Pi URL.';
      });

      checkButton.addEventListener('click', () => {
        badge.className = 'connection-badge connection-checking';
        badge.textContent = 'Checking';
        status.textContent = 'Checking the Raspberry Pi service...';
        bridge.checkPiConnection();
      });
    }

    function receiveConnectionStatus(connected) {
      setConnectionState(Boolean(connected));
    }

    return { initialize, receiveConnectionStatus };
  }

  return Object.assign(createGateway(nativeBridge), { createGateway });
});
