(function attachAdmin(root, factory) {
  const api = factory(root?.smsWeb || null, root?.fetch?.bind(root));

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.admin = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, (nativeBridge, fetchApi) => {
  'use strict';

  let statusElement;
  let resultHandler;

  function valueFor(input) {
    if (input.type === 'number') return Number(input.value);
    return input.value.trim();
  }

  function payloadFor(form) {
    return [...form.elements].reduce((payload, input) => {
      if (input.name) payload[input.name] = valueFor(input);
      return payload;
    }, {});
  }

  async function submit(kind, payload, key) {
    if (nativeBridge && typeof nativeBridge.submitAuthorityUpdate === 'function') {
      const result = nativeBridge.submitAuthorityUpdate(kind, JSON.stringify(payload));
      if (result !== 'queued') throw new Error('The Android authority update could not be queued.');
      return { queued: true };
    }

    if (!fetchApi) throw new Error('The local service is unavailable.');
    if (!key) throw new Error('Enter the local service administrator key.');
    const endpoint = kind === 'shelter' ? 'shelters' : `${kind}s`;
    const response = await fetchApi(`./admin/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SMSWeb-Key': key
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Local service returned HTTP ${response.status}.`);
    return body;
  }

  function receiveResult(kind, success, message) {
    if (statusElement) {
      statusElement.className = success ? 'form-status success-status' : 'form-status error-status';
      statusElement.textContent = message;
    }
    if (resultHandler) resultHandler({ kind, success: Boolean(success), message });
  }

  function initialize({ container, keyInput, status, onResult } = {}) {
    if (!container || !status) return;
    statusElement = status;
    resultHandler = typeof onResult === 'function' ? onResult : null;
    const nativeMode = Boolean(nativeBridge && typeof nativeBridge.submitAuthorityUpdate === 'function');
    const keyLabel = container.querySelector('#authority-key-label');
    if (nativeMode) {
      if (keyInput) keyInput.hidden = true;
      if (keyLabel) keyLabel.hidden = true;
    }

    container.querySelectorAll('[data-authority-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        const kind = form.dataset.authorityForm;
        button.disabled = true;
        statusElement.className = 'form-status';
        statusElement.textContent = `Validating and publishing ${kind} update...`;
        try {
          const result = await submit(kind, payloadFor(form), keyInput?.value.trim() || '');
          if (result.queued) {
            statusElement.textContent = 'Update queued through the native gateway.';
          } else {
            receiveResult(kind, true, `Authority ${kind} update saved. New SMS responses will include it.`);
          }
        } catch (error) {
          receiveResult(kind, false, error.message);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  return { initialize, payloadFor, submit, receiveResult };
});
