import {
  applyRemoteRecordDeletion,
  enqueueBackup,
  loadAllRecords,
  loadBackupQueue,
  loadDeletedRecords,
  putRecordWithoutBackup,
  removeBackupQueueItem,
  upsertDeletedRecord,
  updateAttachmentBackupState,
  updateBackupQueueItem,
  updateRecordBackupState,
} from "./storage";
import { getImageBlob, putImageBlob } from "@/lib/db/imageBlobStore";
import type { CGMPBackupSummary, CGMPDeletedRecord, CGMPRecord } from "./types";
import type { ImageAttachment } from "@/types/image";

export type BackupProcessItemResult = {
  ok: boolean;
  recordId: string;
  title?: string;
  itemType?: "record" | "attachment" | "delete";
  skipped?: boolean;
  attachmentId?: string;
  driveFileId?: string;
  previewDriveFileId?: string;
  thumbnailDriveFileId?: string;
  blobPathname?: string;
  blobUrl?: string;
  previewBlobPathname?: string;
  previewBlobUrl?: string;
  previewBlobDownloadUrl?: string;
  thumbnailBlobPathname?: string;
  thumbnailBlobUrl?: string;
  thumbnailBlobDownloadUrl?: string;
  checksum?: string;
  backedUpAt?: string;
  elapsedMs?: number;
  blobElapsedMs?: number;
  uploadElapsedMs?: number;
  previewSizeBytes?: number;
  thumbnailSizeBytes?: number;
  error?: string;
};

type BackupProcessResponse = {
  ok: boolean;
  results?: BackupProcessItemResult[];
  error?: string;
  detail?: string;
};

type DriveBackupRecord = {
  id: string;
  title: string;
  summary: string;
  backed_up_at: string;
  checksum: string;
  file_id: string;
  pathname?: string;
  url?: string;
  uploaded_at?: string;
  record?: Partial<CGMPRecord>;
  error?: boolean;
};

type DriveManifest = {
  deleted_records?: Record<string, CGMPDeletedRecord>;
  attachments?: Record<
    string,
    {
      record_id?: string;
      attachment_id?: string;
      preview_file_id?: string;
      thumbnail_file_id?: string;
      checksum?: string;
      backed_up_at?: string;
    }
  >;
};

type RestoreResponse = {
  ok?: boolean;
  records?: DriveBackupRecord[];
  tombstones?: Array<{ id: string; tombstone?: CGMPDeletedRecord; error?: string }>;
  manifest?: DriveManifest;
  error?: string;
};

type TombstoneBackupResponse = {
  ok?: boolean;
  backedUpAt?: string;
  blobPathname?: string;
  blobUrl?: string;
  error?: string;
  detail?: string;
};

const BACKUP_CONCURRENCY = 3;

function nextRetryAt(retryCount: number) {
  const delaySeconds = Math.min(60 * 30, Math.max(10, 2 ** retryCount * 10));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function isRetryDue(value: string) {
  if (!value) return true;
  const time = new Date(value).getTime();
  return !Number.isFinite(time) || time <= Date.now();
}

async function loadLatestRecord(recordId: string) {
  const records = await loadAllRecords();
  return records.find((record) => record.id === recordId) || null;
}

function backupItemPriority(item: { item_type: "record" | "attachment"; created_at?: string }) {
  // Attachments must be uploaded first so the following record JSON contains Drive file IDs.
  return item.item_type === "attachment" ? 0 : 1;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function attachmentBackupSource(attachment: ImageAttachment) {
  return {
    id: attachment.id,
    type: attachment.type,
    previewBlobKey: attachment.previewBlobKey,
    thumbnailBlobKey: attachment.thumbnailBlobKey || "",
    originalFileName: attachment.originalFileName || "",
    mimeType: attachment.mimeType,
    previewSizeBytes: attachment.previewSizeBytes || 0,
    thumbnailSizeBytes: attachment.thumbnailSizeBytes || 0,
    previewWidth: attachment.previewWidth || 0,
    previewHeight: attachment.previewHeight || 0,
    thumbnailWidth: attachment.thumbnailWidth || 0,
    thumbnailHeight: attachment.thumbnailHeight || 0,
    created_at: attachment.created_at,
    image_type: attachment.image_type,
    summary_80: attachment.summary_80,
    image_tags: attachment.image_tags || [],
    visible_text: attachment.visible_text,
    confidence: attachment.confidence,
    analysis_status: attachment.analysis_status,
    previewDriveFileId: attachment.previewDriveFileId || "",
    thumbnailDriveFileId: attachment.thumbnailDriveFileId || "",
    previewBlobPathname: attachment.previewBlobPathname || "",
    previewBlobUrl: attachment.previewBlobUrl || "",
    previewBlobDownloadUrl: attachment.previewBlobDownloadUrl || "",
    thumbnailBlobPathname: attachment.thumbnailBlobPathname || "",
    thumbnailBlobUrl: attachment.thumbnailBlobUrl || "",
    thumbnailBlobDownloadUrl: attachment.thumbnailBlobDownloadUrl || "",
  };
}

function recordBackupSource(record: CGMPRecord) {
  return {
    schema_version: record.schema_version,
    id: record.id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    raw_input: record.raw_input,
    title: record.title,
    summary: record.summary,
    body: record.body,
    action: record.action,
    tags: record.tags || [],
    para: record.para,
    domain: record.domain,
    date: record.date,
    time: record.time,
    all_day: record.all_day,
    duration_minutes: record.duration_minutes,
    location: record.location,
    confirmation: record.confirmation,
    note_tags: record.note_tags,
    note_index_line: record.note_index_line,
    user_intent_summary: record.user_intent_summary,
    ai_status: record.ai_status,
    ai_error: record.ai_error,
    external_action_status: record.external_action_status,
    external_target: record.external_target,
    external_registered_at: record.external_registered_at,
    external_error: record.external_error,
    google_task_id: record.google_task_id,
    google_task_list_id: record.google_task_list_id,
    google_task_status: record.google_task_status,
    google_task_updated_at: record.google_task_updated_at,
    google_calendar_event_id: record.google_calendar_event_id,
    google_calendar_id: record.google_calendar_id,
    google_calendar_updated_at: record.google_calendar_updated_at,
    attachments: (record.attachments || []).map(attachmentBackupSource),
    ai: record.ai,
  };
}

async function getRecordBackupChecksum(record: CGMPRecord) {
  return sha256Text(stableStringify(recordBackupSource(record)));
}

function hasBackupAfterLatestUpdate(record: CGMPRecord) {
  const lastBackupAt = new Date(record.last_backup_at || "").getTime();
  const updatedAt = new Date(record.updated_at || record.created_at || "").getTime();
  return Number.isFinite(lastBackupAt) && Number.isFinite(updatedAt) && lastBackupAt >= updatedAt;
}

async function shouldSkipRecordUpload(record: CGMPRecord) {
  const checksum = await getRecordBackupChecksum(record);
  return {
    checksum,
    skip: Boolean(record.backup_checksum && record.backup_checksum === checksum && hasBackupAfterLatestUpdate(record)),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

async function backupRecord(record: CGMPRecord): Promise<BackupProcessItemResult> {
  const startedAt = performance.now();
  const { skip, checksum } = await shouldSkipRecordUpload(record);
  if (skip) {
    return {
      ok: true,
      recordId: record.id,
      title: record.title || record.summary || record.raw_input || record.id,
      itemType: "record",
      skipped: true,
      driveFileId: record.drive_file_id,
      checksum,
      backedUpAt: record.last_backup_at,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  const response = await fetch("/api/backup/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record }),
  });
  const payload = (await response.json().catch(() => ({}))) as BackupProcessResponse & BackupProcessItemResult;
  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      recordId: record.id,
      title: record.title || record.summary || record.raw_input || record.id,
      itemType: "record",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: payload.detail || payload.error || "DRIVE_RECORD_SAVE_FAILED",
    };
  }
  return {
    ok: true,
    recordId: record.id,
    title: record.title || record.summary || record.raw_input || record.id,
    itemType: "record",
    driveFileId: payload.driveFileId,
    blobPathname: payload.blobPathname,
    blobUrl: payload.blobUrl,
    checksum,
    backedUpAt: payload.backedUpAt,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

async function backupDeletedRecord(tombstone: CGMPDeletedRecord): Promise<BackupProcessItemResult> {
  const startedAt = performance.now();
  const response = await fetch("/api/backup/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tombstone }),
  });
  const payload = (await response.json().catch(() => ({}))) as TombstoneBackupResponse;
  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      recordId: tombstone.record_id,
      title: tombstone.title || tombstone.record_id,
      itemType: "delete",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: payload.detail || payload.error || "DRIVE_DELETE_TOMBSTONE_SAVE_FAILED",
    };
  }
  return {
    ok: true,
    recordId: tombstone.record_id,
    title: tombstone.title || tombstone.record_id,
    itemType: "delete",
    backedUpAt: payload.backedUpAt,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

async function processDeletedRecordBackup(tombstone: CGMPDeletedRecord) {
  await upsertDeletedRecord({
    ...tombstone,
    drive_backup_status: "backing_up",
    drive_backup_last_error: "",
  });
  const result = await backupDeletedRecord(tombstone);
  if (result.ok) {
    await upsertDeletedRecord({
      ...tombstone,
      drive_backup_status: "backed_up",
      drive_backup_retry_count: 0,
      drive_backup_last_error: "",
      drive_backup_next_retry_at: "",
      drive_backed_up_at: result.backedUpAt || new Date().toISOString(),
    });
    return result;
  }

  const retryCount = tombstone.drive_backup_retry_count + 1;
  await upsertDeletedRecord({
    ...tombstone,
    drive_backup_status: "backup_failed",
    drive_backup_retry_count: retryCount,
    drive_backup_last_error: result.error || "DELETE_TOMBSTONE_BACKUP_FAILED",
    drive_backup_next_retry_at: nextRetryAt(retryCount),
  });
  return result;
}

export async function backupAttachment(record: CGMPRecord, attachment: ImageAttachment): Promise<BackupProcessItemResult> {
  const startedAt = performance.now();
  const blobStartedAt = performance.now();
  const previewBlob = await getImageBlob(attachment.previewBlobKey);
  if (!previewBlob) {
    return {
      ok: false,
      recordId: record.id,
      title: record.title || record.summary || record.raw_input || record.id,
      itemType: "attachment",
      attachmentId: attachment.id,
      elapsedMs: Math.round(performance.now() - startedAt),
      blobElapsedMs: Math.round(performance.now() - blobStartedAt),
      error: "PREVIEW_BLOB_NOT_FOUND",
    };
  }

  const thumbnailBlob = attachment.thumbnailBlobKey ? await getImageBlob(attachment.thumbnailBlobKey) : null;
  const blobElapsedMs = Math.round(performance.now() - blobStartedAt);
  const formData = new FormData();
  formData.append("recordId", record.id);
  formData.append("attachment", JSON.stringify(attachment));
  formData.append("preview", previewBlob, "preview.jpg");
  if (thumbnailBlob) {
    formData.append("thumbnail", thumbnailBlob, "thumbnail.jpg");
  }

  const uploadStartedAt = performance.now();
  const response = await fetch("/api/backup/attachment", {
    method: "POST",
    body: formData,
  });
  const uploadElapsedMs = Math.round(performance.now() - uploadStartedAt);
  const payload = (await response.json().catch(() => ({}))) as BackupProcessItemResult & {
    ok?: boolean;
    detail?: string;
  };
  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      recordId: record.id,
      title: record.title || record.summary || record.raw_input || record.id,
      itemType: "attachment",
      attachmentId: attachment.id,
      elapsedMs: Math.round(performance.now() - startedAt),
      blobElapsedMs,
      uploadElapsedMs,
      previewSizeBytes: previewBlob.size,
      thumbnailSizeBytes: thumbnailBlob?.size || 0,
      error: payload.detail || payload.error || "ATTACHMENT_BACKUP_REQUEST_FAILED",
    };
  }
  return {
    ok: true,
    recordId: record.id,
    title: record.title || record.summary || record.raw_input || record.id,
      itemType: "attachment",
      attachmentId: attachment.id,
      previewDriveFileId: payload.previewDriveFileId,
      thumbnailDriveFileId: payload.thumbnailDriveFileId,
      previewBlobPathname: payload.previewBlobPathname,
      previewBlobUrl: payload.previewBlobUrl,
      previewBlobDownloadUrl: payload.previewBlobDownloadUrl,
      thumbnailBlobPathname: payload.thumbnailBlobPathname,
      thumbnailBlobUrl: payload.thumbnailBlobUrl,
      thumbnailBlobDownloadUrl: payload.thumbnailBlobDownloadUrl,
    checksum: payload.checksum,
    backedUpAt: payload.backedUpAt,
    elapsedMs: Math.round(performance.now() - startedAt),
    blobElapsedMs,
    uploadElapsedMs,
    previewSizeBytes: previewBlob.size,
    thumbnailSizeBytes: thumbnailBlob?.size || 0,
  };
}

export async function processBackupQueue() {
  const [records, queue, tombstones] = await Promise.all([loadAllRecords(), loadBackupQueue(), loadDeletedRecords()]);
  const backupableRecords = records.filter((record) => record.ai_status !== "pending_ai");
  const recordIds = new Set(backupableRecords.map((record) => record.id));
  const queuedIds = new Set(queue.map((item) => item.id));
  const syntheticAttachmentItems = backupableRecords.flatMap((record) =>
    (record.attachments || [])
      .filter((attachment) => attachment.backup_status !== "backed_up")
      .filter((attachment) => isRetryDue(attachment.backup_next_retry_at || ""))
      .filter((attachment) => !queuedIds.has(`attachment:${record.id}:${attachment.id}`))
      .map((attachment) => ({
        id: `attachment:${record.id}:${attachment.id}`,
        record_id: record.id,
        item_type: "attachment" as const,
        attachment_id: attachment.id,
        status: "pending_backup" as const,
        retry_count: attachment.backup_retry_count || 0,
        last_error: attachment.backup_last_error || "",
        next_retry_at: attachment.backup_next_retry_at || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
  );
  const dueItems = [...queue, ...syntheticAttachmentItems]
    .filter((item) => isRetryDue(item.next_retry_at))
    .sort((left, right) => {
      const priority = backupItemPriority(left) - backupItemPriority(right);
      if (priority !== 0) return priority;
      return (left.created_at || "").localeCompare(right.created_at || "");
    });
  const results: BackupProcessItemResult[] = [];

  const dueTombstones = tombstones
    .filter((item) => item.drive_backup_status !== "backed_up")
    .filter((item) => isRetryDue(item.drive_backup_next_retry_at || ""));

  const tombstoneResults = await mapWithConcurrency(dueTombstones, BACKUP_CONCURRENCY, processDeletedRecordBackup);
  results.push(...tombstoneResults);

  const plannedRecordIds = new Map<string, string>();
  for (const item of dueItems) {
    if (!recordIds.has(item.record_id)) {
      await removeBackupQueueItem(item.id);
      continue;
    }

    const currentCreatedAt = plannedRecordIds.get(item.record_id);
    if (!currentCreatedAt || (item.created_at || "") < currentCreatedAt) {
      plannedRecordIds.set(item.record_id, item.created_at || new Date().toISOString());
    }
  }

  const recordPlans = Array.from(plannedRecordIds.entries())
    .sort(([, leftCreatedAt], [, rightCreatedAt]) => leftCreatedAt.localeCompare(rightCreatedAt))
    .map(([recordId]) => recordId);

  const recordResults = await mapWithConcurrency(recordPlans, BACKUP_CONCURRENCY, (recordId) =>
    processSingleRecordBackup(recordId, { respectRetry: true })
  );
  results.push(...recordResults.flat());

  return results;
}

export async function processSingleRecordBackup(recordId: string, options: { respectRetry?: boolean } = {}) {
  const results: BackupProcessItemResult[] = [];
  const record = await loadLatestRecord(recordId);
  if (!record) {
    return [
      {
        ok: false,
        recordId,
        title: recordId,
        itemType: "record" as const,
        elapsedMs: 0,
        error: "RECORD_NOT_FOUND",
      },
    ];
  }
  if (record.ai_status === "pending_ai") {
    await removeBackupQueueItem(record.id);
    for (const attachment of record.attachments || []) {
      await removeBackupQueueItem(`attachment:${record.id}:${attachment.id}`);
    }
    return [
      {
        ok: true,
        recordId,
        title: record.title || record.summary || record.raw_input || record.id,
        itemType: "record" as const,
        skipped: true,
        elapsedMs: 0,
      },
    ];
  }

  for (const attachment of record.attachments || []) {
    const attachmentQueueId = `attachment:${record.id}:${attachment.id}`;
    if (attachment.backup_status === "backed_up" && (attachment.previewDriveFileId || attachment.previewBlobPathname || attachment.previewBlobUrl)) {
      await removeBackupQueueItem(attachmentQueueId);
      continue;
    }

    if (options.respectRetry && !isRetryDue(attachment.backup_next_retry_at || "")) {
      continue;
    }

    await updateAttachmentBackupState(record.id, attachment.id, {
      backup_status: "backing_up",
      blob_upload_status: "backing_up",
      backup_last_error: "",
      blob_upload_error: "",
    });

    const latestRecord = (await loadLatestRecord(record.id)) || record;
    const latestAttachment =
      (latestRecord.attachments || []).find((candidate) => candidate.id === attachment.id) || attachment;
    const result = await backupAttachment(latestRecord, latestAttachment);
    results.push(result);

    if (result.ok) {
      await updateAttachmentBackupState(record.id, attachment.id, {
        backup_status: "backed_up",
        blob_upload_status: "backed_up",
        backup_retry_count: 0,
        backup_last_error: "",
        backup_next_retry_at: "",
        previewDriveFileId: result.previewDriveFileId || latestAttachment.previewDriveFileId || "",
        thumbnailDriveFileId: result.thumbnailDriveFileId || latestAttachment.thumbnailDriveFileId || "",
        previewBlobPathname: result.previewBlobPathname || latestAttachment.previewBlobPathname || "",
        previewBlobUrl: result.previewBlobUrl || latestAttachment.previewBlobUrl || "",
        previewBlobDownloadUrl: result.previewBlobDownloadUrl || latestAttachment.previewBlobDownloadUrl || "",
        thumbnailBlobPathname: result.thumbnailBlobPathname || latestAttachment.thumbnailBlobPathname || "",
        thumbnailBlobUrl: result.thumbnailBlobUrl || latestAttachment.thumbnailBlobUrl || "",
        thumbnailBlobDownloadUrl: result.thumbnailBlobDownloadUrl || latestAttachment.thumbnailBlobDownloadUrl || "",
        blob_uploaded_at: result.backedUpAt || new Date().toISOString(),
        blob_upload_error: "",
        last_backup_at: result.backedUpAt || new Date().toISOString(),
        backup_checksum: result.checksum || latestAttachment.backup_checksum || "",
      });
      await removeBackupQueueItem(attachmentQueueId);
    } else {
      const retryCount = (latestAttachment.backup_retry_count || 0) + 1;
      const retryAt = nextRetryAt(retryCount);
      await updateAttachmentBackupState(record.id, attachment.id, {
        backup_status: "backup_failed",
        blob_upload_status: "backup_failed",
        backup_retry_count: retryCount,
        backup_last_error: result.error || "ATTACHMENT_BACKUP_FAILED",
        backup_next_retry_at: retryAt,
        blob_upload_error: result.error || "ATTACHMENT_BACKUP_FAILED",
      });
      await updateBackupQueueItem({
        id: attachmentQueueId,
        record_id: record.id,
        item_type: "attachment",
        attachment_id: attachment.id,
        status: "backup_failed",
        retry_count: retryCount,
        last_error: result.error || "ATTACHMENT_BACKUP_FAILED",
        next_retry_at: retryAt,
        created_at: latestAttachment.created_at || record.created_at,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const latestRecord = (await loadLatestRecord(record.id)) || record;
  const recordQueueId = `record:${record.id}`;
  await updateRecordBackupState(record.id, {
    backup_status: "backing_up",
    backup_last_error: "",
  });
  await updateBackupQueueItem({
    id: recordQueueId,
    record_id: record.id,
    item_type: "record",
    attachment_id: "",
    status: "backing_up",
    retry_count: latestRecord.backup_retry_count || 0,
    last_error: "",
    next_retry_at: "",
    created_at: latestRecord.created_at,
    updated_at: new Date().toISOString(),
  });

  const recordResult = await backupRecord(latestRecord);
  results.push(recordResult);

  if (recordResult.ok) {
    await updateRecordBackupState(record.id, {
      backup_status: "backed_up",
      backup_retry_count: 0,
      backup_last_error: "",
      backup_next_retry_at: "",
      drive_file_id: recordResult.driveFileId || latestRecord.drive_file_id,
      last_backup_at: recordResult.backedUpAt || new Date().toISOString(),
      backup_checksum: recordResult.checksum || latestRecord.backup_checksum,
    });
    await removeBackupQueueItem(recordQueueId);
  } else {
    const retryCount = (latestRecord.backup_retry_count || 0) + 1;
    const retryAt = nextRetryAt(retryCount);
    await updateRecordBackupState(record.id, {
      backup_status: "backup_failed",
      backup_retry_count: retryCount,
      backup_last_error: recordResult.error || "BACKUP_FAILED",
      backup_next_retry_at: retryAt,
    });
    await updateBackupQueueItem({
      id: recordQueueId,
      record_id: record.id,
      item_type: "record",
      attachment_id: "",
      status: "backup_failed",
      retry_count: retryCount,
      last_error: recordResult.error || "BACKUP_FAILED",
      next_retry_at: retryAt,
      created_at: latestRecord.created_at,
      updated_at: new Date().toISOString(),
    });
  }

  return results;
}

export async function enqueueAllRecordsForBackup() {
  const records = await loadAllRecords();
  const backupableRecords = records.filter((record) => record.ai_status !== "pending_ai");
  await Promise.all(backupableRecords.map((record) => enqueueBackup(record.id)));
  return backupableRecords.length;
}

export async function getBackupStatus(): Promise<CGMPBackupSummary> {
  const [allRecords, queue] = await Promise.all([loadAllRecords(), loadBackupQueue()]);
  const records = allRecords.filter((record) => record.ai_status !== "pending_ai");
  const summary: CGMPBackupSummary = {
    localOnly: 0,
    pending: 0,
    backingUp: 0,
    backedUp: 0,
    failed: 0,
    conflicted: 0,
    queue: queue.length,
    lastBackupAt: "",
  };

  for (const record of records) {
    if (record.backup_status === "pending_backup") summary.pending += 1;
    else if (record.backup_status === "backing_up") summary.backingUp += 1;
    else if (record.backup_status === "backed_up") summary.backedUp += 1;
    else if (record.backup_status === "backup_failed") summary.failed += 1;
    else if (record.backup_status === "conflicted") summary.conflicted += 1;
    else summary.localOnly += 1;

    if (record.last_backup_at && (!summary.lastBackupAt || record.last_backup_at > summary.lastBackupAt)) {
      summary.lastBackupAt = record.last_backup_at;
    }
  }

  return summary;
}

export async function backupDeleteTombstoneNow(tombstone: CGMPDeletedRecord) {
  const saved = await upsertDeletedRecord({
    ...tombstone,
    drive_backup_status: "backing_up",
    drive_backup_last_error: "",
  });
  const result = await backupDeletedRecord(saved);
  if (result.ok) {
    await upsertDeletedRecord({
      ...saved,
      drive_backup_status: "backed_up",
      drive_backup_retry_count: 0,
      drive_backup_last_error: "",
      drive_backup_next_retry_at: "",
      drive_backed_up_at: result.backedUpAt || new Date().toISOString(),
    });
    return result;
  }

  const retryCount = saved.drive_backup_retry_count + 1;
  await upsertDeletedRecord({
    ...saved,
    drive_backup_status: "backup_failed",
    drive_backup_retry_count: retryCount,
    drive_backup_last_error: result.error || "DELETE_TOMBSTONE_BACKUP_FAILED",
    drive_backup_next_retry_at: nextRetryAt(retryCount),
  });
  return result;
}

export async function restoreFromDrive() {
  const response = await fetch("/api/backup/restore");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "RESTORE_FAILED");
  }
  return payload;
}

function isRestorableRecord(value: Partial<CGMPRecord> | undefined): value is CGMPRecord {
  return Boolean(value?.id && value?.created_at && value?.updated_at);
}

function enrichRemoteRecordAttachments(record: CGMPRecord, manifest?: DriveManifest): CGMPRecord {
  const manifestAttachments = manifest?.attachments || {};
  return {
    ...record,
    attachments: (record.attachments || []).map((attachment) => {
      const manifestEntry = manifestAttachments[`${record.id}:${attachment.id}`];
      const previewDriveFileId = attachment.previewDriveFileId || manifestEntry?.preview_file_id || "";
      const thumbnailDriveFileId = attachment.thumbnailDriveFileId || manifestEntry?.thumbnail_file_id || "";
      const backedUpAt = attachment.last_backup_at || manifestEntry?.backed_up_at || "";
      const hasBlobFile = Boolean(attachment.previewBlobPathname || attachment.previewBlobUrl);
      return {
        ...attachment,
        previewDriveFileId,
        thumbnailDriveFileId,
        backup_status: hasBlobFile || previewDriveFileId ? "backed_up" : attachment.backup_status || "local_only",
        blob_upload_status: hasBlobFile ? "backed_up" : attachment.blob_upload_status || attachment.backup_status,
        backup_retry_count: attachment.backup_retry_count || 0,
        backup_last_error: attachment.backup_last_error || "",
        backup_next_retry_at: attachment.backup_next_retry_at || "",
        last_backup_at: backedUpAt,
        backup_checksum: attachment.backup_checksum || manifestEntry?.checksum || "",
      };
    }),
  };
}

async function downloadDriveImageBlob(fileId: string) {
  const response = await fetch(`/api/backup/attachment?fileId=${encodeURIComponent(fileId)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload?.detail === "string" ? payload.detail : "ATTACHMENT_DOWNLOAD_FAILED");
  }
  return response.blob();
}

async function downloadRemoteImageBlob(attachment: ImageAttachment, variant: "preview" | "thumbnail") {
  const driveFileId = variant === "thumbnail" ? attachment.thumbnailDriveFileId : attachment.previewDriveFileId;
  if (driveFileId) return downloadDriveImageBlob(driveFileId);

  const pathname = variant === "thumbnail" ? attachment.thumbnailBlobPathname : attachment.previewBlobPathname;
  if (pathname) {
    const response = await fetch(`/api/blob/file?pathname=${encodeURIComponent(pathname)}`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(
        typeof payload?.detail === "string" ? payload.detail : `VERCEL_BLOB_IMAGE_DOWNLOAD_FAILED_${response.status}`
      );
    }
    return response.blob();
  }

  const url = variant === "thumbnail" ? attachment.thumbnailBlobUrl : attachment.previewBlobUrl;
  if (url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`VERCEL_BLOB_IMAGE_DOWNLOAD_FAILED_${response.status}`);
    }
    return response.blob();
  }

  return null;
}

async function hydrateAttachmentBlobsForRecord(record: CGMPRecord) {
  let hydrated = 0;
  const failed: { attachmentId: string; error: string }[] = [];

  for (const attachment of record.attachments || []) {
    try {
      const hasPreview = await getImageBlob(attachment.previewBlobKey);
      if (!hasPreview && (attachment.previewBlobPathname || attachment.previewBlobUrl || attachment.previewDriveFileId)) {
        const blob = await downloadRemoteImageBlob(attachment, "preview");
        if (!blob) continue;
        await putImageBlob(attachment.previewBlobKey, blob);
        hydrated += 1;
      }

      if (
        attachment.thumbnailBlobKey &&
        (attachment.thumbnailBlobPathname || attachment.thumbnailBlobUrl || attachment.thumbnailDriveFileId)
      ) {
        const hasThumbnail = await getImageBlob(attachment.thumbnailBlobKey);
        if (!hasThumbnail) {
          const blob = await downloadRemoteImageBlob(attachment, "thumbnail");
          if (!blob) continue;
          await putImageBlob(attachment.thumbnailBlobKey, blob);
          hydrated += 1;
        }
      }
    } catch (error) {
      failed.push({
        attachmentId: attachment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { hydrated, failed };
}

function mergeRemoteAttachments(localRecord: CGMPRecord, remoteRecord: CGMPRecord) {
  const localById = new Map((localRecord.attachments || []).map((attachment) => [attachment.id, attachment]));
  let changed = false;
  const merged = [...(localRecord.attachments || [])];

  for (const remoteAttachment of remoteRecord.attachments || []) {
    const localAttachment = localById.get(remoteAttachment.id);
    if (!localAttachment) {
      merged.push(remoteAttachment);
      changed = true;
      continue;
    }

    const nextAttachment: ImageAttachment = {
      ...localAttachment,
      previewDriveFileId: localAttachment.previewDriveFileId || remoteAttachment.previewDriveFileId || "",
      thumbnailDriveFileId: localAttachment.thumbnailDriveFileId || remoteAttachment.thumbnailDriveFileId || "",
      previewBlobPathname: localAttachment.previewBlobPathname || remoteAttachment.previewBlobPathname || "",
      previewBlobUrl: localAttachment.previewBlobUrl || remoteAttachment.previewBlobUrl || "",
      previewBlobDownloadUrl: localAttachment.previewBlobDownloadUrl || remoteAttachment.previewBlobDownloadUrl || "",
      thumbnailBlobPathname: localAttachment.thumbnailBlobPathname || remoteAttachment.thumbnailBlobPathname || "",
      thumbnailBlobUrl: localAttachment.thumbnailBlobUrl || remoteAttachment.thumbnailBlobUrl || "",
      thumbnailBlobDownloadUrl: localAttachment.thumbnailBlobDownloadUrl || remoteAttachment.thumbnailBlobDownloadUrl || "",
      blob_uploaded_at: localAttachment.blob_uploaded_at || remoteAttachment.blob_uploaded_at || "",
      blob_upload_status: localAttachment.blob_upload_status || remoteAttachment.blob_upload_status,
      backup_status:
        localAttachment.backup_status === "backed_up" || remoteAttachment.backup_status === "backed_up"
          ? "backed_up"
          : localAttachment.backup_status || remoteAttachment.backup_status,
      last_backup_at: localAttachment.last_backup_at || remoteAttachment.last_backup_at || "",
      backup_checksum: localAttachment.backup_checksum || remoteAttachment.backup_checksum || "",
      backup_last_error: localAttachment.backup_last_error || "",
      backup_next_retry_at: localAttachment.backup_next_retry_at || "",
      backup_retry_count: localAttachment.backup_retry_count || 0,
    };

    if (JSON.stringify(nextAttachment) !== JSON.stringify(localAttachment)) {
      const index = merged.findIndex((attachment) => attachment.id === localAttachment.id);
      if (index >= 0) merged[index] = nextAttachment;
      changed = true;
    }
  }

  return changed ? { ...localRecord, attachments: merged } : localRecord;
}

export async function hydrateMissingAttachmentBlobs() {
  const records = await loadAllRecords();
  let hydrated = 0;
  const failed: { recordId: string; attachmentId: string; error: string }[] = [];

  for (const record of records) {
    const result = await hydrateAttachmentBlobsForRecord(record);
    hydrated += result.hydrated;
    failed.push(...result.failed.map((item) => ({ recordId: record.id, ...item })));
  }

  return { hydrated, failed };
}

export async function importMissingRecordsFromDrive() {
  const [localRecords, localTombstones, response] = await Promise.all([
    loadAllRecords(),
    loadDeletedRecords(),
    fetch("/api/backup/restore"),
  ]);
  const payload = (await response.json().catch(() => ({}))) as RestoreResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "RESTORE_FAILED");
  }

  const localIds = new Set(localRecords.map((record) => record.id));
  const localById = new Map(localRecords.map((record) => [record.id, record]));
  const deletedRecords = Object.fromEntries(
    (payload.tombstones || [])
      .map((item) => item.tombstone)
      .filter((item): item is CGMPDeletedRecord => Boolean(item?.record_id))
      .map((item) => [item.record_id, item])
  );
  const localDeletedById = new Map(localTombstones.map((tombstone) => [tombstone.record_id, tombstone]));
  const imported: CGMPRecord[] = [];
  const merged: CGMPRecord[] = [];
  const deleted: CGMPDeletedRecord[] = [];
  const skipped: DriveBackupRecord[] = [];

  for (const tombstone of Object.values(deletedRecords)) {
    if (!tombstone?.record_id || !tombstone.deleted_at) continue;
    const localTombstone = localDeletedById.get(tombstone.record_id);
    if (localTombstone && localTombstone.deleted_at >= tombstone.deleted_at) continue;
    await applyRemoteRecordDeletion(tombstone);
    deleted.push(tombstone);
    localIds.delete(tombstone.record_id);
  }

  for (const item of payload.records || []) {
    const tombstone = deletedRecords[item.id] || localDeletedById.get(item.id);
    if (tombstone) {
      skipped.push(item);
      continue;
    }
    if (item.error || !isRestorableRecord(item.record)) {
      skipped.push(item);
      continue;
    }

    const remoteRecord: CGMPRecord = enrichRemoteRecordAttachments({
      ...item.record,
      backup_status: "backed_up",
      backup_retry_count: 0,
      backup_last_error: "",
      backup_next_retry_at: "",
      drive_file_id: item.file_id || item.pathname || "",
      last_backup_at: item.uploaded_at || item.backed_up_at,
      backup_checksum: item.checksum,
    }, payload.manifest);

    if (localIds.has(item.id)) {
      const localRecord = localById.get(item.id);
      if (!localRecord) {
        skipped.push(item);
        continue;
      }
      const mergedRecord = mergeRemoteAttachments(localRecord, remoteRecord);
      if (mergedRecord !== localRecord) {
        await putRecordWithoutBackup(mergedRecord);
        merged.push(mergedRecord);
      } else {
        skipped.push(item);
      }
      continue;
    }

    await putRecordWithoutBackup(remoteRecord);
    imported.push(remoteRecord);
    localIds.add(remoteRecord.id);
  }

  const hydration = await hydrateMissingAttachmentBlobs();

  return {
    imported,
    merged,
    deleted,
    skipped,
    hydratedAttachments: hydration.hydrated,
    failedAttachments: hydration.failed,
    totalRemote: payload.records?.length || 0,
  };
}
