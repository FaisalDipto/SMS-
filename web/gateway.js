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
    let authenticationStatus;
    let authenticationBadge;
    let callStatus;
    let callCommandMapping = null;

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
      requestHazardsButton,
      requestStatusElement,
      authenticationKeyInput,
      saveAuthenticationKeyButton,
      authenticationStatusElement,
      authenticationBadgeElement,
      authenticationKeyControls,
      replaceAuthenticationKeyButton,
      administratorSetup,
      roleSelect,
      roleSelector,
      saveRoleButton,
      roleDescription,
      roleRoot,
      gatewayEyebrow,
      gatewayTitle,
      callShelterButton,
      callAlertButton,
      callHazardButton,
      callStatusElement,
      onRequest
    }) {
      badge = badgeElement;
      status = statusElement;
      serviceNumberInput = serviceNumber;
      requestStatus = requestStatusElement;
      authenticationStatus = authenticationStatusElement;
      authenticationBadge = authenticationBadgeElement;
      callStatus = callStatusElement;
      requestHandler = typeof onRequest === 'function' ? onRequest : null;

      if (!urlInput || !saveButton || !checkButton || !status || !badge ||
        !serviceNumberInput || !saveServiceNumberButton || !requestSheltersButton ||
        !requestAlertsButton || !requestHazardsButton || !requestStatus || !authenticationKeyInput ||
        !saveAuthenticationKeyButton || !authenticationStatus || !authenticationBadge ||
        !authenticationKeyControls || !replaceAuthenticationKeyButton || !administratorSetup) {
        return;
      }

      if (!bridge || typeof bridge.getPiUrl !== 'function') {
        if (roleSelector) roleSelector.hidden = true;
        status.textContent = 'Native gateway controls are available in the Android app.';
        authenticationStatus.textContent =
          'Authentication is provisioned through the Android gateway app.';
        authenticationBadge.className = 'security-badge security-unknown';
        authenticationBadge.textContent = 'Android only';
        administratorSetup.open = false;
        saveButton.disabled = true;
        checkButton.disabled = true;
        saveServiceNumberButton.disabled = true;
        requestSheltersButton.disabled = true;
        requestAlertsButton.disabled = true;
        requestHazardsButton.disabled = true;
        authenticationKeyInput.disabled = true;
        saveAuthenticationKeyButton.disabled = true;
        replaceAuthenticationKeyButton.disabled = true;
        return;
      }

      urlInput.value = bridge.getPiUrl() || '';
      serviceNumberInput.value = typeof bridge.getServiceNumber === 'function'
        ? bridge.getServiceNumber() || ''
        : '';
      status.textContent = 'Pi URL loaded. Check the connection when the service is running.';
      const authenticationConfigured = bridge.getAuthenticationStatus?.() === 'configured';
      const initialRole = getAppRole();
      const roleLocked = bridge.isRoleLocked?.() === true;
      const userConfigurationLocked = bridge.isUserConfigurationLocked?.() === true;
      if (roleSelector) roleSelector.hidden = roleLocked;
      if (administratorSetup && userConfigurationLocked) administratorSetup.hidden = true;
      if (roleSelect) roleSelect.value = initialRole;
      applyAppRole(initialRole, {
        roleRoot,
        roleDescription,
        gatewayEyebrow,
        gatewayTitle,
        administratorSetup
      });
      if (!roleLocked) {
        saveRoleButton?.addEventListener('click', () => {
          const savedRole = saveAppRole(roleSelect?.value);
          if (roleSelect) roleSelect.value = savedRole;
          applyAppRole(savedRole, {
            roleRoot,
            roleDescription,
            gatewayEyebrow,
            gatewayTitle,
            administratorSetup
          });
        });
      }
      setAuthenticationState(authenticationConfigured, {
        authenticationKeyInput,
        saveAuthenticationKeyButton,
        authenticationKeyControls,
        replaceAuthenticationKeyButton,
        administratorSetup
      });
      if (userConfigurationLocked) {
        authenticationStatus.textContent =
          'The controlled-demo response verification profile is installed.';
        authenticationBadge.textContent = 'Ready';
        requestStatus.textContent = serviceNumberInput.value
          ? `Ready to request crisis information from ${serviceNumberInput.value}.`
          : 'This User build has no SMS service number. Rebuild it with a configured number.';
      }

      saveAuthenticationKeyButton.addEventListener('click', () => {
        const result = bridge.saveAuthenticationKey?.(authenticationKeyInput.value);
        authenticationKeyInput.value = '';
        if (result === 'configured') {
          setAuthenticationState(true, {
            authenticationKeyInput,
            saveAuthenticationKeyButton,
            authenticationKeyControls,
            replaceAuthenticationKeyButton,
            administratorSetup
          });
        } else {
          authenticationStatus.textContent =
            'Use the same key as the Pi service (at least 16 characters).';
          authenticationBadge.className = 'security-badge security-required';
          authenticationBadge.textContent = 'Setup required';
        }
      });

      replaceAuthenticationKeyButton.addEventListener('click', () => {
        authenticationKeyControls.hidden = false;
        authenticationKeyInput.disabled = false;
        saveAuthenticationKeyButton.disabled = false;
        replaceAuthenticationKeyButton.hidden = true;
        authenticationStatus.textContent =
          'Administrator key replacement is active. Enter the new Pi service key.';
        authenticationKeyInput.focus?.();
      });

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
          requestStatus.textContent =
            `Shelter request ${result.requestId} sent by SMS. Waiting for the gateway response; the map will update automatically.`;
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
          requestStatus.textContent =
            `Alert request ${result.requestId} sent by SMS. Waiting for the gateway response.`;
          requestAlertsButton.dataset.requestId = result.requestId;
          if (requestHandler) {
            void requestHandler(result);
          }
        } catch (error) {
          requestStatus.textContent = error.message;
        }
      });

      requestHazardsButton.addEventListener('click', () => {
        try {
          const result = sendHazardRequest(serviceNumberInput.value, 'DHK');
          requestStatus.textContent =
            `Hazard request ${result.requestId} sent by SMS. Waiting for the gateway response.`;
          requestHazardsButton.dataset.requestId = result.requestId;
          if (requestHandler) {
            void requestHandler(result);
          }
        } catch (error) {
          requestStatus.textContent = error.message;
        }
      });

      callShelterButton?.addEventListener('click', () => {
        startCallSequence(serviceNumberInput.value, 'SHELTER');
      });

      callAlertButton?.addEventListener('click', () => {
        startCallSequence(serviceNumberInput.value, 'ALERT');
      });

      callHazardButton?.addEventListener('click', () => {
        startCallSequence(serviceNumberInput.value, 'HAZARD');
      });
    }

    function getAppRole() {
      const value = bridge?.getAppRole?.();
      return String(value || 'GATEWAY').toUpperCase() === 'USER' ? 'USER' : 'GATEWAY';
    }

    function saveAppRole(value) {
      if (!bridge?.saveAppRole) return getAppRole();
      return String(bridge.saveAppRole(value) || 'GATEWAY').toUpperCase() === 'USER'
        ? 'USER'
        : 'GATEWAY';
    }

    function applyAppRole(role, elements = {}) {
      const userMode = role === 'USER';
      if (elements.roleRoot?.dataset) elements.roleRoot.dataset.appRole = role;
      if (elements.roleDescription) {
        elements.roleDescription.textContent = userMode
          ? 'User mode sends requests and renders authenticated response SMS messages on this phone.'
          : 'Gateway mode receives public requests, contacts the Pi, and returns response SMS messages.';
      }
      if (elements.gatewayEyebrow) {
        elements.gatewayEyebrow.textContent = userMode ? 'Personal SMS client' : 'Gateway connection';
      }
      if (elements.gatewayTitle) {
        elements.gatewayTitle.textContent = userMode ? 'Crisis information by SMS' : 'Raspberry Pi service';
      }
      if (elements.administratorSetup) {
        const summary = elements.administratorSetup.querySelector?.('summary');
        if (summary) summary.textContent = userMode ? 'User device setup' : 'Administrator setup';
      }
    }

    function setAuthenticationState(configured, controls) {
      authenticationBadge.className =
        `security-badge ${configured ? 'security-configured' : 'security-required'}`;
      authenticationBadge.textContent = configured ? 'Protected' : 'Setup required';
      authenticationStatus.textContent = configured
        ? 'Signed responses are verified by this gateway.'
        : 'Administrator provisioning is required; crisis responses are blocked.';
      controls.authenticationKeyControls.hidden = configured;
      controls.authenticationKeyInput.disabled = configured;
      controls.saveAuthenticationKeyButton.disabled = configured;
      controls.replaceAuthenticationKeyButton.hidden = !configured;
      controls.replaceAuthenticationKeyButton.disabled = false;
      controls.administratorSetup.open = !configured;
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

    function sendHazardRequest(recipient, region) {
      return sendRequest(recipient, 'HAZARD', region);
    }

    function getCallCommandMapping() {
      if (callCommandMapping) return callCommandMapping;
      if (!bridge || typeof bridge.getCallCommandMapping !== 'function') return null;
      try {
        callCommandMapping = JSON.parse(bridge.getCallCommandMapping() || '{}');
      } catch (_error) {
        callCommandMapping = null;
      }
      return callCommandMapping;
    }

    function startCallSequence(recipient, command) {
      if (!callStatus) return;
      if (!recipient || !recipient.trim()) {
        callStatus.textContent = 'Enter the gateway number before calling.';
        return;
      }
      if (!bridge || typeof bridge.startCallSequence !== 'function') {
        callStatus.textContent = 'Calling is available in the Android app.';
        return;
      }

      const mapping = getCallCommandMapping();
      const totalCalls = mapping ? mapping[command] : undefined;
      if (!totalCalls) {
        callStatus.textContent = 'This device does not have a call mapping for that request.';
        return;
      }

      const status = bridge.startCallSequence(recipient.trim(), totalCalls);
      if (status === 'permission-denied') {
        callStatus.textContent = 'Call permission is not granted.';
        return;
      }
      if (status !== 'started') {
        callStatus.textContent = 'The call could not be started. Check the gateway number.';
        return;
      }

      callStatus.textContent = `Calling ${recipient.trim()}: call 1 of ${totalCalls}. Let it ring, then hang up.`;
    }

    function receiveCallProgress(placed, total) {
      if (!callStatus) return;
      callStatus.textContent = placed >= total
        ? `Call ${placed} of ${total} placed. Let it ring, then hang up.`
        : `Call ${placed} of ${total} placed. Let it ring, then hang up — the next call dials automatically.`;
    }

    function receiveCallSequenceDone() {
      if (!callStatus) return;
      callStatus.textContent = 'Call sequence complete. Waiting for the SMS reply; the page will update automatically.';
    }

    function receiveConnectionStatus(connected) {
      setConnectionState(Boolean(connected));
    }

    function setIncomingHandler(handler) {
      incomingHandler = typeof handler === 'function' ? handler : null;
    }

    function receiveSms(rawText, authentication = 'UNVERIFIED') {
      return incomingHandler ? incomingHandler(rawText, authentication) : undefined;
    }

    function receiveSecurityError(error) {
      const message = `Security check blocked a response: ${error}`;
      if (authenticationStatus) authenticationStatus.textContent = message;
      if (authenticationBadge) {
        authenticationBadge.className = 'security-badge security-blocked';
        authenticationBadge.textContent = 'Blocked response';
      }
      if (requestStatus) requestStatus.textContent = message;
    }

    async function replayPendingResponses() {
      if (!incomingHandler || !bridge || typeof bridge.getPendingResponses !== 'function') {
        return;
      }

      let responses;
      try {
        responses = JSON.parse(bridge.getPendingResponses() || '[]');
      } catch (_error) {
        return;
      }

      for (const response of Array.isArray(responses) ? responses : []) {
        try {
          await incomingHandler(response.text, response.authentication || 'UNVERIFIED');
          bridge.acknowledgeResponse?.(response.text);
        } catch (_error) {
          // Keep the response pending so the next app launch can retry it.
        }
      }
    }

    function getActivity() {
      if (!bridge || typeof bridge.getGatewayActivity !== 'function') return [];
      try {
        const events = JSON.parse(bridge.getGatewayActivity() || '[]');
        return Array.isArray(events) ? events : [];
      } catch (_error) {
        return [];
      }
    }

    function retryQueuedMessages() {
      if (!bridge || typeof bridge.retryQueuedMessages !== 'function') {
        return 'unavailable';
      }
      return bridge.retryQueuedMessages();
    }

    function canRetryQueuedMessages() {
      return getAppRole() === 'GATEWAY' &&
        Boolean(bridge && typeof bridge.retryQueuedMessages === 'function');
    }

    return {
      initialize,
      receiveConnectionStatus,
      setIncomingHandler,
      receiveSms,
      receiveSecurityError,
      replayPendingResponses,
      getActivity,
      retryQueuedMessages,
      canRetryQueuedMessages,
      getAppRole,
      saveAppRole,
      applyAppRole,
      sendShelterRequest,
      sendAlertRequest,
      sendHazardRequest,
      startCallSequence,
      receiveCallProgress,
      receiveCallSequenceDone
    };
  }

  return Object.assign(createGateway(nativeBridge), { createGateway });
});
