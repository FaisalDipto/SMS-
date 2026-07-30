(function attachSimulator(root, factory) {
  const simulator = factory({
    protocol: root?.SMSWeb?.protocol,
    storage: root?.SMSWeb?.storage,
    renderer: root?.SMSWeb?.renderer,
    multipart: root?.SMSWeb?.multipart
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

  function createSimulator({ protocol, storage, renderer, multipart }) {
    async function handleSms(
      rawText,
      appView,
      now = Date.now(),
      source = 'simulator',
      authentication = 'UNVERIFIED'
    ) {
      if (typeof rawText !== 'string' || rawText.trim() === '') {
        throw new Error('Paste an SMS message before parsing');
      }

      if (!appView) {
        throw new Error('The application view is unavailable');
      }

      const messageType = rawText.trim().split('|', 1)[0];

      if (messageType === 'RES') {
        const parsedResponse = protocol.parseResponse(rawText);
        const assembly = multipart?.accept
          ? await multipart.accept(parsedResponse, rawText, now)
          : { status: 'complete', response: parsedResponse, rawTexts: [rawText] };

        if (assembly.status === 'duplicate') {
          return `Duplicate response ${parsedResponse.requestId} ignored.`;
        }
        if (assembly.status === 'pending' || assembly.status === 'duplicate-part') {
          const duplicateLabel = assembly.status === 'duplicate-part' ? ' Duplicate part ignored.' : '';
          const expiredLabel = assembly.expiredPartCount > 0
            ? ' Previous incomplete parts expired.'
            : '';
          return `Waiting for response ${parsedResponse.requestId}: received ${assembly.receivedParts} of ${assembly.totalParts}; missing part ${assembly.missingParts.join(', ')}.${duplicateLabel}${expiredLabel}`;
        }

        const response = assembly.response;
        await storage.saveMessage({
          requestId: response.requestId,
          direction: 'incoming',
          rawText: assembly.rawTexts.join('\n'),
          status: 'received',
          source,
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
          source: response.source || source,
          transportSource: source,
          trust: response.trust || 'UNVERIFIED',
          authentication,
          verifiedAt: response.verifiedAt ? response.verifiedAt * 1_000 : undefined,
          expiresAt: response.expiresAt ? response.expiresAt * 1_000 : undefined
        };

        await storage.savePage(page);
        renderer.mount(appView, renderer.renderShelterPage(page, now));
        await multipart?.complete?.(assembly.responseKey, now);

        return `Rendered ${response.page} response for ${response.region}`;
      }

      if (messageType === 'ALT') {
        const alert = protocol.parseAlert(rawText);
        const record = {
          ...alert,
          expiresAt: alert.expires * 1_000,
          receivedAt: now,
          source,
          authentication
        };

        await storage.saveMessage({
          requestId: alert.alertId,
          direction: 'incoming',
          rawText,
          status: 'received',
          source,
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
