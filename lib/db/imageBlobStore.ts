const DB_NAME = "cgmp-pwa";
const DB_VERSION = 4;
const RECORDS_STORE = "records";
const SETTINGS_STORE = "settings";
const BACKUP_QUEUE_STORE = "backup_queue";
const IMAGE_BLOBS_STORE = "image_blobs";
const DELETED_RECORDS_STORE = "deleted_records";

type ImageBlobEntry = {
  key: string;
  blob: Blob;
  mimeType: string;
  size: number;
  updated_at: string;
};

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
      if (!db.objectStoreNames.contains(BACKUP_QUEUE_STORE)) {
        const store = db.createObjectStore(BACKUP_QUEUE_STORE, { keyPath: "id" });
        store.createIndex("record_id", "record_id", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("next_retry_at", "next_retry_at", { unique: false });
      }
      if (!db.objectStoreNames.contains(IMAGE_BLOBS_STORE)) {
        db.createObjectStore(IMAGE_BLOBS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(DELETED_RECORDS_STORE)) {
        const store = db.createObjectStore(DELETED_RECORDS_STORE, { keyPath: "record_id" });
        store.createIndex("deleted_at", "deleted_at", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

export async function putImageBlob(key: string, blob: Blob) {
  if (!hasWindow()) return;

  const startedAt = performance.now();
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_BLOBS_STORE, "readwrite");
    const entry: ImageBlobEntry = {
      key,
      blob,
      mimeType: blob.type || "image/jpeg",
      size: blob.size,
      updated_at: new Date().toISOString(),
    };
    tx.objectStore(IMAGE_BLOBS_STORE).put(entry);
    tx.oncomplete = () => {
      db.close();
      console.debug("[cgmp:image] blob save completed", {
        key,
        size: blob.size,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      resolve();
    };
    tx.onerror = () => {
      db.close();
      console.debug("[cgmp:image] blob save failed", { key, error: tx.error });
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };
  });
}

export async function getImageBlob(key: string) {
  if (!hasWindow()) return null;

  const db = await openDatabase();
  try {
    const tx = db.transaction(IMAGE_BLOBS_STORE, "readonly");
    const entry = await requestToPromise<ImageBlobEntry | undefined>(tx.objectStore(IMAGE_BLOBS_STORE).get(key));
    return entry?.blob || null;
  } finally {
    db.close();
  }
}

export async function deleteImageBlob(key: string) {
  if (!hasWindow()) return;

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_BLOBS_STORE, "readwrite");
    tx.objectStore(IMAGE_BLOBS_STORE).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };
  });
}

export async function deleteImageBlobs(keys: string[]) {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  if (!hasWindow() || uniqueKeys.length === 0) return;

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_BLOBS_STORE, "readwrite");
    const store = tx.objectStore(IMAGE_BLOBS_STORE);
    uniqueKeys.forEach((key) => store.delete(key));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };
  });
}

export async function clearImageBlobs() {
  if (!hasWindow()) return;

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGE_BLOBS_STORE, "readwrite");
    tx.objectStore(IMAGE_BLOBS_STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };
  });
}
