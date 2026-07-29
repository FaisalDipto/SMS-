(function attachStorage(root, factory) {
  const protocol = root?.SMSWeb?.protocol ||
    (typeof require === 'function' ? require('./protocol.js') : null);
  const storage = factory(root?.indexedDB, protocol);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = storage;
  }

  if (root) {
    root.SMSWeb = root.SMSWeb || {};
    root.SMSWeb.storage = storage;
  }
})(typeof window !== 'undefined' ? window : globalThis, (indexedDBApi, protocol) => {
  'use strict';

  const DB_NAME = 'smsweb';
  const DB_VERSION = 1;
  const STORES = Object.freeze({
    PAGES: 'pages',
    ALERTS: 'alerts',
    MESSAGES: 'messages',
    SETTINGS: 'settings'
  });

  function storageError(message) {
    return new Error(`SMSWeb storage error: ${message}`);
  }

  function requireRecord(record, field) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw storageError(`${field} must be an object`);
    }
  }

  function requireText(value, field, { allowEmpty = false } = {}) {
    if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
      throw storageError(`${field} must be a non-empty string`);
    }
  }

  function openDatabase() {
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
      return Promise.reject(storageError('IndexedDB is unavailable in this environment'));
    }

    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(STORES.PAGES)) {
          database.createObjectStore(STORES.PAGES, { keyPath: 'pageId' });
        }

        if (!database.objectStoreNames.contains(STORES.ALERTS)) {
          database.createObjectStore(STORES.ALERTS, { keyPath: 'alertId' });
        }

        if (!database.objectStoreNames.contains(STORES.MESSAGES)) {
          database.createObjectStore(STORES.MESSAGES, { keyPath: 'requestId' });
        }

        if (!database.objectStoreNames.contains(STORES.SETTINGS)) {
          database.createObjectStore(STORES.SETTINGS, { keyPath: 'settingName' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || storageError('could not open database'));
    });
  }

  function runRequest(storeName, mode, operation) {
    return openDatabase().then((database) => new Promise((resolve, reject) => {
      let request;

      try {
        const transaction = database.transaction(storeName, mode);
        request = operation(transaction.objectStore(storeName));
      } catch (error) {
        database.close?.();
        reject(error);
        return;
      }

      request.onsuccess = () => {
        database.close?.();
        resolve(request.result);
      };
      request.onerror = () => {
        database.close?.();
        reject(request.error || storageError(`operation failed in ${storeName}`));
      };
    }));
  }

  function saveMessage(message) {
    requireRecord(message, 'message');
    requireText(message.requestId, 'message.requestId');
    requireText(message.rawText, 'message.rawText', { allowEmpty: true });

    if (!['incoming', 'outgoing'].includes(message.direction)) {
      throw storageError('message.direction must be incoming or outgoing');
    }

    const record = {
      ...message,
      status: message.status || (message.direction === 'incoming' ? 'received' : 'queued'),
      createdAt: message.createdAt ?? Date.now()
    };

    return runRequest(STORES.MESSAGES, 'readwrite', (store) => store.put(record));
  }

  function savePage(page) {
    requireRecord(page, 'page');
    requireText(page.pageId, 'page.pageId');
    requireText(page.title, 'page.title');
    requireText(page.content, 'page.content', { allowEmpty: true });

    const record = {
      ...page,
      receivedAt: page.receivedAt ?? Date.now(),
      source: page.source || 'sms'
    };

    return runRequest(STORES.PAGES, 'readwrite', (store) => store.put(record));
  }

  function saveAlert(alert) {
    requireRecord(alert, 'alert');
    requireText(alert.alertId, 'alert.alertId');
    requireText(alert.message, 'alert.message');

    const record = {
      ...alert,
      receivedAt: alert.receivedAt ?? Date.now()
    };

    return runRequest(STORES.ALERTS, 'readwrite', (store) => store.put(record));
  }

  function getPage(pageId) {
    requireText(pageId, 'pageId');
    return runRequest(STORES.PAGES, 'readonly', (store) => store.get(pageId));
  }

  function getActiveAlerts(now = Date.now()) {
    if (!Number.isFinite(now)) {
      throw storageError('now must be a finite timestamp');
    }

    return runRequest(STORES.ALERTS, 'readonly', (store) => store.getAll())
      .then((alerts) => alerts.filter((alert) => alert.expiresAt > now));
  }

  function queueRequest(request) {
    requireRecord(request, 'request');
    requireText(request.requestId, 'request.requestId');

    let rawText = request.rawText;
    if (typeof rawText !== 'string' && protocol?.serializeRequest) {
      rawText = protocol.serializeRequest(request);
    }

    requireText(rawText, 'request.rawText');

    return saveMessage({
      requestId: request.requestId,
      direction: 'outgoing',
      rawText,
      status: 'queued',
      createdAt: request.createdAt ?? Date.now()
    });
  }

  return {
    DB_NAME,
    DB_VERSION,
    STORES,
    openDatabase,
    saveMessage,
    savePage,
    saveAlert,
    getPage,
    getActiveAlerts,
    queueRequest
  };
});
