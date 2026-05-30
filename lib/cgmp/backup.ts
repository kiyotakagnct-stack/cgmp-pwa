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

type BackupProcessItemResult = {
  ok: boolean;
  recordId: string;
  itemType?: "record" | "attachment" | "delete";
  attachmentId?: string;
  driveFileId?: string;
  previewDriveFileId?: string;
  thumbnailDriveFileId?: string;
  checksum?: string;
  backedUpAt?: string;
  error?: string;
};

type BackupProcessResponse = {
  ok: boolean;
  results?: BackupProcessItemResult[];
  error?: string;
};

type DriveBackupRecord = {
  id: string;
  title: string;
  summary: string;
  backed_up_at: string;
  checksum: string;
  file_id: string;
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
  manifest?: DriveManifest;
  error?: string;
};

type TombstoneBackupResponse = {
  ok?: boolean;
  backedUpAt?: string;
  error?: string;
};

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

async function backupRecord(record: CGMPRecord): Promise<BackupProcessItemResult> {
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
      error: payload.error || "BACKUP_REQUEST_FAILED",
    };
  }
  return {
    ok: true,
    recordId: record.id,
    itemType: "record",
    driveFileId: payload.driveFileId,
    checksum: payload.checksum,
    backedUpAt: payload.backedUpAt,
  };
}

async function backupDeletedRecord(tombstone: CGMPDeletedRecord): Promise<BackupProcessItemResult> {
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
      itemType: "delete",
      error: payload.error || "DELETE_TOMBSTONE_BACKUP_FAILED",
    };
  }
  return {
    ok: true,
    recordId: tombstone.record_id,
    itemType: "delete",
    backedUpAt: payload.backedUpAt,
  };
}

export async function backupAttachment(record: CGMPRecord, attachment: ImageAttachment): Promise<BackupProcessItemResult> {
  const previewBlob = await getImageBlob(attachment.previewBlobKey);
  if (!previewBlob) {
    return {
      ok: false,
      recordId: record.id,
      attachmentId: attachment.id,
      error: "PREVIEW_BLOB_NOT_FOUND",
    };
  }

  const thumbnailBlob = attachment.thumbnailBlobKey ? await getImageBlob(attachment.thumbnailBlobKey) : null;
  const formData = new FormData();
  formData.append("recordId", record.id);
  formData.append("attachment", JSON.stringify(attachment));
  formData.append("preview", previewBlob, "preview.jpg");
  if (thumbnailBlob) {
    formData.append("thumbnail", thumbnailBlob, "thumbnail.jpg");
  }

  const response = await fetch("/api/backup/attachment", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json().catch(() => ({}))) as BackupProcessItemResult & {
    ok?: boolean;
    detail?: string;
  };
  if (!response.ok || !payload.ok) {
    return {
      ok: false,
      recordId: record.id,
      attachmentId: attachment.id,
      error: payload.detail || payload.error || "ATTACHMENT_BACKUP_REQUEST_FAILED",
    };
  }
  return {
    ok: true,
    recordId: record.id,
    itemType: "attachment",
    attachmentId: attachment.id,
    previewDriveFileId: payload.previewDriveFileId,
    thumbnailDriveFileId: payload.thumbnailDriveFileId,
    checksum: payload.checksum,
    backedUpAt: payload.backedUpAt,
  };
}

export async function processBackupQueue() {
  const [records, queue, tombstones] = await Promise.all([loadAllRecords(), loadBackupQueue(), loadDeletedRecords()]);
  const queuedIds = new Set(queue.map((item) => item.id));
  const syntheticAttachmentItems = records.flatMap((record) =>
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

  for (const tombstone of tombstones.filter((item) => isRetryDue(""))) {
    const result = await backupDeletedRecord(tombstone);
    results.push(result);
  }

  for (const item of dueItems) {
    const record = await loadLatestRecord(item.record_id);
    if (!record) {
      await removeBackupQueueItem(item.id);
      continue;
    }

    if (item.item_type === "attachment") {
      const attachment = (record.attachments || []).find((candidate) => candidate.id === item.attachment_id);
      if (!attachment) {
        await removeBackupQueueItem(item.id);
        continue;
      }

      await updateAttachmentBackupState(record.id, attachment.id, { backup_status: "backing_up" });
      await updateBackupQueueItem({ ...item, status: "backing_up" });

      const result = await backupAttachment(record, attachment);
      results.push(result);

      if (result.ok) {
        await updateAttachmentBackupState(record.id, attachment.id, {
          backup_status: "backed_up",
          backup_retry_count: 0,
          backup_last_error: "",
          backup_next_retry_at: "",
          previewDriveFileId: result.previewDriveFileId || attachment.previewDriveFileId || "",
          thumbnailDriveFileId: result.thumbnailDriveFileId || attachment.thumbnailDriveFileId || "",
          last_backup_at: result.backedUpAt || new Date().toISOString(),
          backup_checksum: result.checksum || attachment.backup_checksum || "",
        });
        await removeBackupQueueItem(item.id);
        await enqueueBackup(record.id);
        continue;
      }

      const retryCount = item.retry_count + 1;
      const retryAt = nextRetryAt(retryCount);
      await updateAttachmentBackupState(record.id, attachment.id, {
        backup_status: "backup_failed",
        backup_retry_count: retryCount,
        backup_last_error: result.error || "ATTACHMENT_BACKUP_FAILED",
        backup_next_retry_at: retryAt,
      });
      await updateBackupQueueItem({
        ...item,
        status: "backup_failed",
        retry_count: retryCount,
        last_error: result.error || "ATTACHMENT_BACKUP_FAILED",
        next_retry_at: retryAt,
      });
      continue;
    }

    await updateRecordBackupState(record.id, { backup_status: "backing_up" });
    await updateBackupQueueItem({ ...item, status: "backing_up" });

    const result = await backupRecord(record);
    results.push(result);

    if (result.ok) {
      await updateRecordBackupState(record.id, {
        backup_status: "backed_up",
        backup_retry_count: 0,
        backup_last_error: "",
        backup_next_retry_at: "",
        drive_file_id: result.driveFileId || record.drive_file_id,
        last_backup_at: result.backedUpAt || new Date().toISOString(),
        backup_checksum: result.checksum || record.backup_checksum,
      });
      await removeBackupQueueItem(item.id);
      continue;
    }

    const retryCount = item.retry_count + 1;
    const retryAt = nextRetryAt(retryCount);
    await updateRecordBackupState(record.id, {
      backup_status: "backup_failed",
      backup_retry_count: retryCount,
      backup_last_error: result.error || "BACKUP_FAILED",
      backup_next_retry_at: retryAt,
    });
    await updateBackupQueueItem({
      ...item,
      status: "backup_failed",
      retry_count: retryCount,
      last_error: result.error || "BACKUP_FAILED",
      next_retry_at: retryAt,
    });
  }

  return results;
}

export async function enqueueAllRecordsForBackup() {
  const records = await loadAllRecords();
  await Promise.all(records.map((record) => enqueueBackup(record.id)));
  return records.length;
}

export async function getBackupStatus(): Promise<CGMPBackupSummary> {
  const [records, queue] = await Promise.all([loadAllRecords(), loadBackupQueue()]);
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
  const saved = await upsertDeletedRecord(tombstone);
  return backupDeletedRecord(saved);
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
      return {
        ...attachment,
        previewDriveFileId,
        thumbnailDriveFileId,
        backup_status: previewDriveFileId ? "backed_up" : attachment.backup_status || "local_only",
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

async function hydrateAttachmentBlobsForRecord(record: CGMPRecord) {
  let hydrated = 0;
  const failed: { attachmentId: string; error: string }[] = [];

  for (const attachment of record.attachments || []) {
    try {
      const hasPreview = await getImageBlob(attachment.previewBlobKey);
      if (!hasPreview && attachment.previewDriveFileId) {
        const blob = await downloadDriveImageBlob(attachment.previewDriveFileId);
        await putImageBlob(attachment.previewBlobKey, blob);
        hydrated += 1;
      }

      if (attachment.thumbnailBlobKey && attachment.thumbnailDriveFileId) {
        const hasThumbnail = await getImageBlob(attachment.thumbnailBlobKey);
        if (!hasThumbnail) {
          const blob = await downloadDriveImageBlob(attachment.thumbnailDriveFileId);
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
  const deletedRecords = payload.manifest?.deleted_records || {};
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
      drive_file_id: item.file_id,
      last_backup_at: item.backed_up_at,
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
