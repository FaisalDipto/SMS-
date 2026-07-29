(function attachGateway(root, factory) {
  const gateway = factory(root?.smsWeb || null, root?.SMSWeb?.protocol || null);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = gateway;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.gateway = gateway;
  }
})(typeof window !== 'undefined' ? window : globalThis, (nativeBridge, protocol) => {
  'use strict';

  function createGateway(bridge, protocolApi = protocol) {
    let badge;
    let status;
    let incomingHandler;
    let serviceNumberInput;
    let requestStatus;
    let requestHandler;

    function setConnectionState(connected) {
      if (!badge || !status) return;

      badge.className = `connection-badge ${connected ? 'connection-online' : 'connection-offline'}`;
      badge.textContent = connected ? 'Connected' : 'Unavailable';
      status.textContent = connected
        ? 'The Raspberry Pi service is reachable on the local network.'
        : 'The Raspberry Pi service could not be reached. Queued SMS messages will retry.';
    }

    function initialize({
      urlInput,
      saveButton,
      checkButton,
      statusElement,
      badgeElement,
      serviceNumber,
      saveServiceNumberButton,
      requestSheltersButton,
      requestAlertsButton,
      requestStatusElement,
      onRequest
    }) {
      badge = badgeElement;
      status = statusElement;
      serviceNumberInput = serviceNumber;
      requestStatus = requestStatusElement;
      requestHandler = typeof onRequest === 'function' ? onRequest : null;

      if (!urlInput || !saveButton || !checkButton || !status || !badge ||
        !serviceNumberInput || !saveServiceNumberButton || !requestSheltersButton ||
        !requestAlertsButton || !requestStatus) {
        return;
      }

      if (!bridge || typeof bridge.getPiUrl !== 'function') {
        status.textContent = 'Native gateway controls are available in the Android app.';
        saveButton.disabled = true;
        checkButton.disabled = true;
        saveServiceNumberButton.disabled = true;
        requestSheltersButton.disabled = true;
        requestAlertsButton.disabled = true;
        return;
      }

      urlInput.value = bridge.getPiUrl() || '';
      serviceNumberInput.value = typeof bridge.getServiceNumber === 'function'
        ? bridge.getServiceNumber() || ''
        : '';
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

      saveServiceNumberButton.addEventListener('click', () => {
        const savedNumber = bridge.saveServiceNumber(serviceNumberInput.value);
        serviceNumberInput.value = savedNumber || serviceNumberInput.value.trim();
        requestStatus.textContent = savedNumber
          ? 'Gateway SMS number saved on this phone.'
          : 'Enter the gateway SMS number.';
      });

      requestSheltersButton.addEventListener('click', () => {
        try {
          const result = sendShelterRequest(serviceNumberInput.value, 'DHK');
          requestStatus.textContent = `Request ${result.requestId} queued for SMS delivery.`;
          requestSheltersButton.dataset.requestId = result.requestId;
          if (requestHandler) {
            void requestHandler(result);
          }
        } catch (error) {
          requestStatus.textContent = error.message;
        }
      });

      requestAlertsButton.addEventListener('click', () => {
        try {
          const result = sendAlertRequest(serviceNumberInput.value, 'DHK');
          requestStatus.textContent = `Alert request ${result.requestId} queued for SMS delivery.`;
          requestAlertsButton.dataset.requestId = result.requestId;
          if (requestHandler) {
            void requestHandler(result);
          }
        } catch (error) {
          requestStatus.textContent = error.message;
        }
      });
    }

    function createRequestId() {
      return `R${Date.now().toString(36).slice(-5).toUpperCase()}`;
    }

    function sendRequest(recipient, command, region) {
      if (!bridge || typeof bridge.sendSms !== 'function') {
        throw new Error('SMS sending is available in the Android app.');
      }
      if (!protocolApi?.serializeRequest) {
        throw new Error('SMS protocol is unavailable.');
      }

      const requestId = createRequestId();
      const rawText = protocolApi.serializeRequest({
        requestId,
        command,
        arguments: region.trim().toUpperCase()
      });
      const sendStatus = bridge.sendSms(recipient, rawText);

      if (sendStatus !== 'queued') {
        throw new Error(sendStatus === 'permission-denied'
          ? 'SMS permission is not granted.'
          : 'The request could not be sent. Check the gateway number.');
      }

      return { requestId, rawText, status: sendStatus };
    }

    function sendShelterRequest(recipient, region) {
      return sendRequest(recipient, 'SHELTER', region);
    }

    function sendAlertRequest(recipient, region) {
      return sendRequest(recipient, 'ALERT', region);
    }

    function receiveConnectionStatus(connected) {
      setConnectionState(Boolean(connected));
    }

    function setIncomingHandler(handler) {
      incomingHandler = typeof handler === 'function' ? handler : null;
    }

    function receiveSms(rawText) {
      return incomingHandler ? incomingHandler(rawText) : undefined;
    }

    return {
      initialize,
      receiveConnectionStatus,
      setIncomingHandler,
      receiveSms,
      sendShelterRequest,
      sendAlertRequest
    };
  }

  return Object.assign(createGateway(nativeBridge), { createGateway });
});
