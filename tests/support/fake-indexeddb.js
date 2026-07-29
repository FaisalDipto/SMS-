class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
}

class FakeObjectStore {
  constructor(keyPath) {
    this.keyPath = keyPath;
    this.records = new Map();
  }

  put(value) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      this.records.set(value[this.keyPath], value);
      request.result = value[this.keyPath];
      request.onsuccess?.();
    });
    return request;
  }

  get(key) {
    const request = new FakeRequest();
    queueMicrotask(() => {
      request.result = this.records.get(key);
      request.onsuccess?.();
    });
    return request;
  }

  getAll() {
    const request = new FakeRequest();
    queueMicrotask(() => {
      request.result = [...this.records.values()];
      request.onsuccess?.();
    });
    return request;
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = {
      contains: (name) => this.stores.has(name)
    };
  }

  createObjectStore(name, { keyPath }) {
    const store = new FakeObjectStore(keyPath);
    this.stores.set(name, store);
    return store;
  }

  transaction(storeName) {
    const store = this.stores.get(storeName);
    if (!store) {
      throw new Error(`Unknown fake store: ${storeName}`);
    }

    return { objectStore: () => store };
  }

  close() {}
}

class FakeIndexedDB {
  constructor() {
    this.database = null;
  }

  open() {
    const request = new FakeRequest();

    queueMicrotask(() => {
      if (!this.database) {
        this.database = new FakeDatabase();
        request.result = this.database;
        request.onupgradeneeded?.();
      }

      request.result = this.database;
      request.onsuccess?.();
    });

    return request;
  }
}

global.indexedDB = new FakeIndexedDB();

function createFakeIndexedDB() {
  return global.indexedDB;
}

module.exports = { createFakeIndexedDB };
