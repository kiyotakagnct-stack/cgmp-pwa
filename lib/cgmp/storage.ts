import type {
  CGMPBackupQueueItem,
  CGMPBackupStatus,
  CGMPDeletedRecord,
  CGMPEmbeddingIndex,
  CGMPExternalDeleteStatus,
  CGMPRecord,
  CGMPSettings,
  CGMPSemanticSearchResultMode,
} from "./types";
import { clearImageBlobs, deleteImageBlobs } from "@/lib/db/imageBlobStore";
import type { ImageAttachment } from "@/types/image";

const DB_NAME = "cgmp-pwa";
const DB_VERSION = 5;
const RECORDS_STORE = "records";
const SETTINGS_STORE = "settings";
const BACKUP_QUEUE_STORE = "backup_queue";
const IMAGE_BLOBS_STORE = "image_blobs";
const DELETED_RECORDS_STORE = "deleted_records";
const EMBEDDING_INDEX_STORE = "embedding_index";
const SETTINGS_KEY = "settings";
const DEVICE_ID_KEY = "cgmp-device-id";
const DEFAULT_SEMANTIC_SEARCH_THRESHOLD = 0.45;

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
      if (!db.objectStoreNames.contains(EMBEDDING_INDEX_STORE)) {
        const store = db.createObjectStore(EMBEDDING_INDEX_STORE, { keyPath: "record_id" });
        store.createIndex("model", "model", { unique: false });
        store.createIndex("source_updated_at", "source_updated_at", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

function createDeviceId() {
  if (!hasWindow()) return "server";
  try {
    const current = window.localStorage.getItem(DEVICE_ID_KEY);
    if (current) return current;
    const next = `device_${crypto.randomUUID()}`;
    window.localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return "device_unknown";
  }
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
      backup_status: source.backup_status || "local_only",
      backup_retry_count: Number.isFinite(Number(source.backup_retry_count)) ? Number(source.backup_retry_count) : 0,
      backup_last_error: source.backup_last_error || "",
      backup_next_retry_at: source.backup_next_retry_at || "",
      previewDriveFileId: source.previewDriveFileId || "",
      thumbnailDriveFileId: source.thumbnailDriveFileId || "",
      previewBlobPathname: source.previewBlobPathname || "",
      previewBlobUrl: source.previewBlobUrl || "",
      previewBlobDownloadUrl: source.previewBlobDownloadUrl || "",
      thumbnailBlobPathname: source.thumbnailBlobPathname || "",
      thumbnailBlobUrl: source.thumbnailBlobUrl || "",
      thumbnailBlobDownloadUrl: source.thumbnailBlobDownloadUrl || "",
      blob_uploaded_at: source.blob_uploaded_at || "",
      blob_upload_status: source.blob_upload_status || source.backup_status || "local_only",
      blob_upload_error: source.blob_upload_error || "",
      last_backup_at: source.last_backup_at || "",
      backup_checksum: source.backup_checksum || "",
    });
  }
  return attachments;
}

function normalizeDeletedRecord(value: unknown): CGMPDeletedRecord | null {
  const source = value && typeof value === "object" ? (value as Partial<CGMPDeletedRecord>) : {};
  if (!source.record_id || !source.deleted_at) return null;
  return {
    schema_version: 1,
    record_id: String(source.record_id),
    deleted_at: String(source.deleted_at),
    source_device_id: String(source.source_device_id || createDeviceId()),
    title: String(source.title || ""),
    updated_at: String(source.updated_at || source.deleted_at),
    drive_file_id: String(source.drive_file_id || ""),
    attachment_drive_file_ids: Array.isArray(source.attachment_drive_file_ids)
      ? source.attachment_drive_file_ids.map((id) => String(id)).filter(Boolean)
      : [],
    google_task_id: String(source.google_task_id || ""),
    google_task_list_id: String(source.google_task_list_id || ""),
    google_calendar_event_id: String(source.google_calendar_event_id || ""),
    google_calendar_id: String(source.google_calendar_id || ""),
    external_delete_status: (source.external_delete_status || "none") as CGMPExternalDeleteStatus,
    external_delete_error: String(source.external_delete_error || ""),
    drive_backup_status: (source.drive_backup_status || "pending_backup") as CGMPBackupStatus,
    drive_backup_retry_count: Number.isFinite(Number(source.drive_backup_retry_count)) ? Number(source.drive_backup_retry_count) : 0,
    drive_backup_last_error: String(source.drive_backup_last_error || ""),
    drive_backup_next_retry_at: String(source.drive_backup_next_retry_at || ""),
    drive_backed_up_at: String(source.drive_backed_up_at || ""),
  };
}

function getAttachmentBlobKeys(record: Pick<CGMPRecord, "attachments">) {
  return (record.attachments || []).flatMap((attachment) =>
    [attachment.previewBlobKey, attachment.thumbnailBlobKey].filter(Boolean) as string[]
  );
}

function normalizeRecord(record: CGMPRecord): CGMPRecord {
  return {
    ...record,
    external_action_status: record.external_action_status || "none",
    external_target: record.external_target || "",
    external_registered_at: record.external_registered_at || "",
    external_error: record.external_error || "",
    google_task_id: record.google_task_id || "",
    google_task_list_id: record.google_task_list_id || "",
    google_task_status: record.google_task_status || "",
    google_task_updated_at: record.google_task_updated_at || "",
    google_calendar_event_id: record.google_calendar_event_id || "",
    google_calendar_id: record.google_calendar_id || "",
    google_calendar_updated_at: record.google_calendar_updated_at || "",
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
    semantic_search_threshold: DEFAULT_SEMANTIC_SEARCH_THRESHOLD,
    semantic_search_result_mode: "threshold",
    external_sync_past_days: 7,
    external_sync_future_days: 60,
    external_sync_exclude_completed_tasks: true,
    external_sync_exclude_ended_calendar: false,
    created_at: now,
    updated_at: now,
  };
}

function normalizeSemanticSearchThreshold(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SEMANTIC_SEARCH_THRESHOLD;
  return Math.min(1, Math.max(-1, number));
}

function normalizeSemanticSearchResultMode(value: unknown): CGMPSemanticSearchResultMode {
  return value === "top10" ? "top10" : "threshold";
}

function normalizeExternalSyncDays(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(3650, Math.max(0, Math.round(number)));
}

export async function loadSettings(): Promise<CGMPSettings> {
  if (!hasWindow()) return createDefaultSettings();

  const db = await openDatabase();
  try {
    const tx = db.transaction(SETTINGS_STORE, "readonly");
    const store = tx.objectStore(SETTINGS_STORE);
    const result = await requestToPromise<CGMPSettings | undefined>(store.get(SETTINGS_KEY));
    const merged = result ? { ...createDefaultSettings(), ...result } : createDefaultSettings();
    return {
      ...merged,
      semantic_search_threshold: normalizeSemanticSearchThreshold(merged.semantic_search_threshold),
      semantic_search_result_mode: normalizeSemanticSearchResultMode(merged.semantic_search_result_mode),
      external_sync_past_days: normalizeExternalSyncDays(merged.external_sync_past_days, 7),
      external_sync_future_days: normalizeExternalSyncDays(merged.external_sync_future_days, 60),
      external_sync_exclude_completed_tasks: merged.external_sync_exclude_completed_tasks !== false,
      external_sync_exclude_ended_calendar: merged.external_sync_exclude_ended_calendar === true,
    };
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
    semantic_search_threshold: normalizeSemanticSearchThreshold(settings.semantic_search_threshold ?? current.semantic_search_threshold),
    semantic_search_result_mode: normalizeSemanticSearchResultMode(
      settings.semantic_search_result_mode ?? current.semantic_search_result_mode
    ),
    external_sync_past_days: normalizeExternalSyncDays(settings.external_sync_past_days ?? current.external_sync_past_days, 7),
    external_sync_future_days: normalizeExternalSyncDays(settings.external_sync_future_days ?? current.external_sync_future_days, 60),
    external_sync_exclude_completed_tasks:
      settings.external_sync_exclude_completed_tasks ?? current.external_sync_exclude_completed_tasks,
    external_sync_exclude_ended_calendar: settings.external_sync_exclude_ended_calendar ?? current.external_sync_exclude_ended_calendar,
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

export async function loadDeletedRecords() {
  if (!hasWindow()) return [];

  const db = await openDatabase();
  try {
    const tx = db.transaction(DELETED_RECORDS_STORE, "readonly");
    const store = tx.objectStore(DELETED_RECORDS_STORE);
    const result = await requestToPromise<CGMPDeletedRecord[]>(store.getAll());
    return (Array.isArray(result) ? result : [])
      .map(normalizeDeletedRecord)
      .filter((item): item is CGMPDeletedRecord => Boolean(item))
      .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
  } finally {
    db.close();
  }
}

export async function upsertDeletedRecord(tombstone: CGMPDeletedRecord) {
  if (!hasWindow()) return tombstone;
  const normalized = normalizeDeletedRecord(tombstone);
  if (!normalized) return tombstone;
  await withTransaction(DELETED_RECORDS_STORE, "readwrite", async (store) => {
    store.put(normalized);
  });
  return normalized;
}

export async function isRecordDeleted(recordId: string) {
  if (!hasWindow()) return false;

  const db = await openDatabase();
  try {
    const tx = db.transaction(DELETED_RECORDS_STORE, "readonly");
    const store = tx.objectStore(DELETED_RECORDS_STORE);
    const result = await requestToPromise<CGMPDeletedRecord | undefined>(store.get(recordId));
    return Boolean(normalizeDeletedRecord(result));
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
  const attachmentQueueItems: CGMPBackupQueueItem[] = (nextRecord.attachments || [])
    .filter((attachment) => attachment.backup_status !== "backed_up")
    .map((attachment) => ({
      id: `attachment:${nextRecord.id}:${attachment.id}`,
      record_id: nextRecord.id,
      item_type: "attachment",
      attachment_id: attachment.id,
      status: "pending_backup",
      retry_count: attachment.backup_retry_count || 0,
      last_error: "",
      next_retry_at: attachment.backup_next_retry_at || "",
      created_at: now,
      updated_at: now,
  }));

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, BACKUP_QUEUE_STORE, DELETED_RECORDS_STORE, EMBEDDING_INDEX_STORE], "readwrite");
    const deletedRequest = tx.objectStore(DELETED_RECORDS_STORE).get(nextRecord.id);

    deletedRequest.onsuccess = () => {
      const tombstone = normalizeDeletedRecord(deletedRequest.result);
      const recordsStore = tx.objectStore(RECORDS_STORE);
      const queueStore = tx.objectStore(BACKUP_QUEUE_STORE);

      if (tombstone) {
        // A deleted record can be resurrected by stale async work (backup/sync) unless
        // the storage layer refuses normal writes after a tombstone exists.
        recordsStore.delete(nextRecord.id);
        queueStore.delete(queueItem.id);
        attachmentQueueItems.forEach((item) => queueStore.delete(item.id));
        return;
      }

      recordsStore.put(nextRecord);
      queueStore.put(queueItem);
      attachmentQueueItems.forEach((item) => queueStore.put(item));
    };
    deletedRequest.onerror = () => {
      reject(deletedRequest.error || new Error("IndexedDB request failed"));
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

  return nextRecord;
}

export async function putRecordWithoutBackup(record: CGMPRecord) {
  if (!hasWindow()) return record;

  await withTransaction(RECORDS_STORE, "readwrite", async (store) => {
    store.put(normalizeRecord(record));
  });

  return record;
}

export async function applyRemoteRecordDeletion(tombstone: CGMPDeletedRecord) {
  if (!hasWindow()) return null;
  const normalized = normalizeDeletedRecord(tombstone);
  if (!normalized) return null;

  const db = await openDatabase();
  let blobKeys: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, BACKUP_QUEUE_STORE, DELETED_RECORDS_STORE, EMBEDDING_INDEX_STORE], "readwrite");
    const recordsStore = tx.objectStore(RECORDS_STORE);
    const getRequest = recordsStore.get(normalized.record_id);
    getRequest.onsuccess = () => {
      const record = getRequest.result ? normalizeRecord(getRequest.result as CGMPRecord) : null;
      blobKeys = record ? getAttachmentBlobKeys(record) : [];
      recordsStore.delete(normalized.record_id);
      const queueStore = tx.objectStore(BACKUP_QUEUE_STORE);
      queueStore.delete(`record:${normalized.record_id}`);
      record?.attachments?.forEach((attachment) => queueStore.delete(`attachment:${normalized.record_id}:${attachment.id}`));
      tx.objectStore(EMBEDDING_INDEX_STORE).delete(normalized.record_id);
      tx.objectStore(DELETED_RECORDS_STORE).put(normalized);
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
  return normalized;
}

export async function deleteRecord(id: string, patch: Partial<CGMPDeletedRecord> = {}) {
  if (!hasWindow()) return null;

  const db = await openDatabase();
  let blobKeys: string[] = [];
  let tombstone: CGMPDeletedRecord | null = null;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, BACKUP_QUEUE_STORE, DELETED_RECORDS_STORE, EMBEDDING_INDEX_STORE], "readwrite");
    const recordsStore = tx.objectStore(RECORDS_STORE);
    const getRequest = recordsStore.get(id);
    getRequest.onsuccess = () => {
      const record = getRequest.result ? normalizeRecord(getRequest.result as CGMPRecord) : null;
      const deletedAt = patch.deleted_at || new Date().toISOString();
      blobKeys = record ? getAttachmentBlobKeys(record) : [];
      tombstone = normalizeDeletedRecord({
        schema_version: 1,
        record_id: id,
        deleted_at: deletedAt,
        source_device_id: patch.source_device_id || createDeviceId(),
        title: patch.title || record?.title || "",
        updated_at: patch.updated_at || record?.updated_at || deletedAt,
        drive_file_id: patch.drive_file_id || record?.drive_file_id || "",
        attachment_drive_file_ids:
          patch.attachment_drive_file_ids ||
          (record?.attachments || []).flatMap((attachment) =>
            [attachment.previewDriveFileId, attachment.thumbnailDriveFileId].filter(Boolean) as string[]
          ),
        google_task_id: patch.google_task_id || record?.google_task_id || "",
        google_task_list_id: patch.google_task_list_id || record?.google_task_list_id || "",
        google_calendar_event_id: patch.google_calendar_event_id || record?.google_calendar_event_id || "",
        google_calendar_id: patch.google_calendar_id || record?.google_calendar_id || "",
        external_delete_status: patch.external_delete_status || "none",
        external_delete_error: patch.external_delete_error || "",
      });
      recordsStore.delete(id);
      tx.objectStore(EMBEDDING_INDEX_STORE).delete(id);
      const queueStore = tx.objectStore(BACKUP_QUEUE_STORE);
      queueStore.delete(`record:${id}`);
      record?.attachments?.forEach((attachment) => queueStore.delete(`attachment:${id}:${attachment.id}`));
      if (tombstone) tx.objectStore(DELETED_RECORDS_STORE).put(tombstone);
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
  return tombstone;
}

export async function clearAllRecords() {
  if (!hasWindow()) return;

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([RECORDS_STORE, BACKUP_QUEUE_STORE, EMBEDDING_INDEX_STORE], "readwrite");
    tx.objectStore(RECORDS_STORE).clear();
    tx.objectStore(BACKUP_QUEUE_STORE).clear();
    tx.objectStore(EMBEDDING_INDEX_STORE).clear();
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

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BACKUP_QUEUE_STORE, DELETED_RECORDS_STORE], "readwrite");
    const deletedRequest = tx.objectStore(DELETED_RECORDS_STORE).get(recordId);
    deletedRequest.onsuccess = () => {
      if (normalizeDeletedRecord(deletedRequest.result)) return;
      tx.objectStore(BACKUP_QUEUE_STORE).put(item);
    };
    deletedRequest.onerror = () => {
      reject(deletedRequest.error || new Error("IndexedDB request failed"));
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

function normalizeEmbeddingIndex(value: unknown): CGMPEmbeddingIndex | null {
  const source = value && typeof value === "object" ? (value as Partial<CGMPEmbeddingIndex>) : {};
  const vector = Array.isArray(source.vector) ? source.vector.map((item) => Number(item)).filter(Number.isFinite) : [];
  if (!source.record_id || vector.length === 0) return null;
  return {
    record_id: String(source.record_id),
    vector,
    model: String(source.model || "text-embedding-3-small"),
    dimensions: Number.isFinite(Number(source.dimensions)) ? Number(source.dimensions) : vector.length,
    embedding_text_hash: String(source.embedding_text_hash || ""),
    source_updated_at: String(source.source_updated_at || ""),
    embedded_at: String(source.embedded_at || new Date().toISOString()),
  };
}

export async function loadEmbeddingIndex() {
  if (!hasWindow()) return [];

  const db = await openDatabase();
  try {
    const tx = db.transaction(EMBEDDING_INDEX_STORE, "readonly");
    const store = tx.objectStore(EMBEDDING_INDEX_STORE);
    const result = await requestToPromise<CGMPEmbeddingIndex[]>(store.getAll());
    return (Array.isArray(result) ? result : [])
      .map(normalizeEmbeddingIndex)
      .filter((item): item is CGMPEmbeddingIndex => Boolean(item));
  } finally {
    db.close();
  }
}

export async function getEmbeddingIndex(recordId: string) {
  if (!hasWindow()) return null;

  const db = await openDatabase();
  try {
    const tx = db.transaction(EMBEDDING_INDEX_STORE, "readonly");
    const store = tx.objectStore(EMBEDDING_INDEX_STORE);
    const result = await requestToPromise<CGMPEmbeddingIndex | undefined>(store.get(recordId));
    return normalizeEmbeddingIndex(result);
  } finally {
    db.close();
  }
}

export async function upsertEmbeddingIndex(index: CGMPEmbeddingIndex) {
  if (!hasWindow()) return index;
  const normalized = normalizeEmbeddingIndex(index);
  if (!normalized) return index;

  await withTransaction(EMBEDDING_INDEX_STORE, "readwrite", async (store) => {
    store.put(normalized);
  });
  return normalized;
}

export async function deleteEmbeddingIndex(recordId: string) {
  if (!hasWindow()) return;
  await withTransaction(EMBEDDING_INDEX_STORE, "readwrite", async (store) => {
    store.delete(recordId);
  });
}

export async function clearEmbeddingIndex() {
  if (!hasWindow()) return;
  await withTransaction(EMBEDDING_INDEX_STORE, "readwrite", async (store) => {
    store.clear();
  });
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

export async function updateAttachmentBackupState(
  recordId: string,
  attachmentId: string,
  patch: Partial<ImageAttachment>
) {
  if (!hasWindow()) return null;

  const db = await openDatabase();
  try {
    const tx = db.transaction(RECORDS_STORE, "readwrite");
    const store = tx.objectStore(RECORDS_STORE);
    const current = await requestToPromise<CGMPRecord | undefined>(store.get(recordId));
    if (!current) return null;
    const normalized = normalizeRecord(current);
    const next: CGMPRecord = {
      ...normalized,
      attachments: (normalized.attachments || []).map((attachment) =>
        attachment.id === attachmentId ? { ...attachment, ...patch } : attachment
      ),
    };
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
