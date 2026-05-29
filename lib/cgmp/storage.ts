import type { CGMPBackupQueueItem, CGMPBackupStatus, CGMPRecord, CGMPSettings } from "./types";
import { clearImageBlobs, deleteImageBlobs } from "@/lib/db/imageBlobStore";
import type { ImageAttachment } from "@/types/image";

const DB_NAME = "cgmp-pwa";
const DB_VERSION = 3;
const RECORDS_STORE = "records";
const SETTINGS_STORE = "settings";
const BACKUP_QUEUE_STORE = "backup_queue";
const IMAGE_BLOBS_STORE = "image_blobs";
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
      if (!db.objectStoreNames.contains(BACKUP_QUEUE_STORE)) {
        const store = db.createObjectStore(BACKUP_QUEUE_STORE, { keyPath: "id" });
        store.createIndex("record_id", "record_id", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("next_retry_at", "next_retry_at", { unique: false });
      }
      if (!db.objectStoreNames.contains(IMAGE_BLOBS_STORE)) {
        db.createObjectStore(IMAGE_BLOBS_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

function normalizeAttachments(value: unknown): ImageAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ImageAttachment[] = [];
  for (const item of value) {
    const source = item && typeof item === "object" ? (item as Partial<ImageAttachment>) : {};
    if (!source.id || source.type !== "image" || !source.previewBlobKey) continue;
    attachments.push({
      ...source,
      id: String(source.id),
      type: "image",
      previewBlobKey: String(source.previewBlobKey),
      thumbnailBlobKey: source.thumbnailBlobKey ? String(source.thumbnailBlobKey) : undefined,
      mimeType: "image/jpeg",
      created_at: String(source.created_at || new Date().toISOString()),
      image_type: source.image_type || "other",
      summary_80: String(source.summary_80 || "画像を添付しました。").slice(0, 120),
      image_tags: Array.isArray(source.image_tags) ? source.image_tags.map((tag) => String(tag)).slice(0, 5) : [],
      visible_text: String(source.visible_text || "").slice(0, 180),
      confidence: source.confidence || "low",
      analysis_status: source.analysis_status || "pending",
    });
  }
  return attachments;
}

function getAttachmentBlobKeys(record: Pick<CGMPRecord, "attachments">) {
  return (record.attachments || []).flatMap((attachment) =>
    [attachment.previewBlobKey, attachment.thumbnailBlobKey].filter(Boolean) as string[]
  );
}

function normalizeRecord(record: CGMPRecord): CGMPRecord {
  return {
    ...record,
    backup_status: record.backup_status || "local_only",
    backup_retry_count: Number.isFinite(Number(record.backup_retry_count)) ? Number(record.backup_retry_count) : 0,
    backup_last_error: record.backup_last_error || "",
    backup_next_retry_at: record.backup_next_retry_at || "",
    drive_file_id: record.drive_file_id || "",
    last_backup_at: record.last_backup_at || "",
    backup_checksum: record.backup_checksum || "",
    attachments: normalizeAttachments(record.attachments),
  };
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
    return (Array.isArray(result) ? result : []).map(normalizeRecord).sort((a, b) => {
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

  const now = new Date().toISOString();
  const nextRecord = normalizeRecord({
    ...record,
    backup_status: "pending_backup",
    backup_last_error: "",
    backup_next_retry_at: "",
  });
  const queueItem: CGMPBackupQueueItem = {
    id: `record:${nextRecord.id}`,
    record_id: nextRecord.id,
    item_type: "record",
    attachment_id: "",
    status: "pending_backup",
    retry_count: 0,
    last_error: "",
    next_retry_at: "",
    created_at: now,
    updated_at: now,
  };

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, BACKUP_QUEUE_STORE], "readwrite");
    tx.objectStore(RECORDS_STORE).put(nextRecord);
    tx.objectStore(BACKUP_QUEUE_STORE).put(queueItem);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };
  });

  return nextRecord;
}

export async function putRecordWithoutBackup(record: CGMPRecord) {
  if (!hasWindow()) return record;

  await withTransaction(RECORDS_STORE, "readwrite", async (store) => {
    store.put(normalizeRecord(record));
  });

  return record;
}

export async function deleteRecord(id: string) {
  if (!hasWindow()) return;

  const db = await openDatabase();
  let blobKeys: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, BACKUP_QUEUE_STORE], "readwrite");
    const recordsStore = tx.objectStore(RECORDS_STORE);
    const getRequest = recordsStore.get(id);
    getRequest.onsuccess = () => {
      const record = getRequest.result ? normalizeRecord(getRequest.result as CGMPRecord) : null;
      blobKeys = record ? getAttachmentBlobKeys(record) : [];
      recordsStore.delete(id);
      tx.objectStore(BACKUP_QUEUE_STORE).delete(`record:${id}`);
    };
    getRequest.onerror = () => {
      reject(getRequest.error || new Error("IndexedDB request failed"));
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };
  });
  await deleteImageBlobs(blobKeys);
}

export async function clearAllRecords() {
  if (!hasWindow()) return;

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, BACKUP_QUEUE_STORE], "readwrite");
    tx.objectStore(RECORDS_STORE).clear();
    tx.objectStore(BACKUP_QUEUE_STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };
  });
  await clearImageBlobs();
}

export async function enqueueBackup(recordId: string) {
  if (!hasWindow()) return;

  const now = new Date().toISOString();
  const item: CGMPBackupQueueItem = {
    id: `record:${recordId}`,
    record_id: recordId,
    item_type: "record",
    attachment_id: "",
    status: "pending_backup",
    retry_count: 0,
    last_error: "",
    next_retry_at: "",
    created_at: now,
    updated_at: now,
  };

  await withTransaction(BACKUP_QUEUE_STORE, "readwrite", async (store) => {
    store.put(item);
  });
}

export async function loadBackupQueue() {
  if (!hasWindow()) return [];

  const db = await openDatabase();
  try {
    const tx = db.transaction(BACKUP_QUEUE_STORE, "readonly");
    const store = tx.objectStore(BACKUP_QUEUE_STORE);
    const result = await requestToPromise<CGMPBackupQueueItem[]>(store.getAll());
    return Array.isArray(result) ? result : [];
  } finally {
    db.close();
  }
}

export async function removeBackupQueueItem(id: string) {
  if (!hasWindow()) return;

  await withTransaction(BACKUP_QUEUE_STORE, "readwrite", async (store) => {
    store.delete(id);
  });
}

export async function updateBackupQueueItem(item: CGMPBackupQueueItem) {
  if (!hasWindow()) return item;

  await withTransaction(BACKUP_QUEUE_STORE, "readwrite", async (store) => {
    store.put({ ...item, updated_at: new Date().toISOString() });
  });

  return item;
}

export async function updateRecordBackupState(
  recordId: string,
  patch: Partial<
    Pick<
      CGMPRecord,
      | "backup_status"
      | "backup_retry_count"
      | "backup_last_error"
      | "backup_next_retry_at"
      | "drive_file_id"
      | "last_backup_at"
      | "backup_checksum"
    >
  >
) {
  if (!hasWindow()) return null;

  const db = await openDatabase();
  try {
    const tx = db.transaction(RECORDS_STORE, "readwrite");
    const store = tx.objectStore(RECORDS_STORE);
    const current = await requestToPromise<CGMPRecord | undefined>(store.get(recordId));
    if (!current) return null;
    const next: CGMPRecord = normalizeRecord({
      ...current,
      ...patch,
      backup_status: (patch.backup_status || current.backup_status || "local_only") as CGMPBackupStatus,
    });
    store.put(next);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    });
    return next;
  } finally {
    db.close();
  }
}
