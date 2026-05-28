import type { CGMPRecord, CGMPSettings } from "./types";

const DB_NAME = "cgmp-pwa";
const DB_VERSION = 1;
const RECORDS_STORE = "records";
const SETTINGS_STORE = "settings";
const SETTINGS_KEY = "settings";

function hasWindow() {
  return typeof window !== "undefined";
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function openDatabase() {
  if (!hasWindow()) {
    throw new Error("IndexedDB is only available in the browser");
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        const store = db.createObjectStore(RECORDS_STORE, { keyPath: "id" });
        store.createIndex("updated_at", "updated_at", { unique: false });
        store.createIndex("created_at", "created_at", { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

async function withTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T> | T
) {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    Promise.resolve(callback(store))
      .then((value) => {
        tx.oncomplete = () => {
          db.close();
          resolve(value);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error || new Error("IndexedDB transaction failed"));
        };
      })
      .catch((error) => {
        db.close();
        reject(error);
      });
  });
}

export function createDefaultSettings(): CGMPSettings {
  const now = new Date().toISOString();
  return {
    id: "settings",
    schema_version: 1,
    openai_model: "gpt-4.1-nano",
    timezone: "Asia/Tokyo",
    created_at: now,
    updated_at: now,
  };
}

export async function loadSettings(): Promise<CGMPSettings> {
  if (!hasWindow()) return createDefaultSettings();

  const db = await openDatabase();
  try {
    const tx = db.transaction(SETTINGS_STORE, "readonly");
    const store = tx.objectStore(SETTINGS_STORE);
    const result = await requestToPromise<CGMPSettings | undefined>(store.get(SETTINGS_KEY));
    return result ? { ...createDefaultSettings(), ...result } : createDefaultSettings();
  } finally {
    db.close();
  }
}

export async function saveSettings(settings: Partial<CGMPSettings>) {
  if (!hasWindow()) return createDefaultSettings();

  const current = await loadSettings();
  const next: CGMPSettings = {
    ...current,
    ...settings,
    id: SETTINGS_KEY,
    updated_at: new Date().toISOString(),
  };

  await withTransaction(SETTINGS_STORE, "readwrite", async (store) => {
    store.put(next, SETTINGS_KEY);
  });

  return next;
}

export async function loadAllRecords() {
  if (!hasWindow()) return [];

  const db = await openDatabase();
  try {
    const tx = db.transaction(RECORDS_STORE, "readonly");
    const store = tx.objectStore(RECORDS_STORE);
    const result = await requestToPromise<CGMPRecord[]>(store.getAll());
    return (Array.isArray(result) ? result : []).sort((a, b) => {
      const aKey = new Date(a.updated_at || a.created_at).getTime();
      const bKey = new Date(b.updated_at || b.created_at).getTime();
      if (aKey === bKey) return String(b.id).localeCompare(String(a.id));
      return bKey - aKey;
    });
  } finally {
    db.close();
  }
}

export async function upsertRecord(record: CGMPRecord) {
  if (!hasWindow()) return record;

  await withTransaction(RECORDS_STORE, "readwrite", async (store) => {
    store.put(record);
  });

  return record;
}

export async function deleteRecord(id: string) {
  if (!hasWindow()) return;

  await withTransaction(RECORDS_STORE, "readwrite", async (store) => {
    store.delete(id);
  });
}

export async function clearAllRecords() {
  if (!hasWindow()) return;

  await withTransaction(RECORDS_STORE, "readwrite", async (store) => {
    store.clear();
  });
}
