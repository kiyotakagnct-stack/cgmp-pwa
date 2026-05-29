import {
  enqueueBackup,
  loadAllRecords,
  loadBackupQueue,
  putRecordWithoutBackup,
  removeBackupQueueItem,
  updateAttachmentBackupState,
  updateBackupQueueItem,
  updateRecordBackupState,
} from "./storage";
import { getImageBlob } from "@/lib/db/imageBlobStore";
import type { CGMPBackupSummary, CGMPRecord } from "./types";
import type { ImageAttachment } from "@/types/image";

type BackupProcessItemResult = {
  ok: boolean;
  recordId: string;
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

type RestoreResponse = {
  ok?: boolean;
  records?: DriveBackupRecord[];
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
    driveFileId: payload.driveFileId,
    checksum: payload.checksum,
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
    attachmentId: attachment.id,
    previewDriveFileId: payload.previewDriveFileId,
    thumbnailDriveFileId: payload.thumbnailDriveFileId,
    checksum: payload.checksum,
    backedUpAt: payload.backedUpAt,
  };
}

export async function processBackupQueue() {
  const [records, queue] = await Promise.all([loadAllRecords(), loadBackupQueue()]);
  const recordById = new Map(records.map((record) => [record.id, record]));
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
  const dueItems = [...queue, ...syntheticAttachmentItems].filter((item) => isRetryDue(item.next_retry_at));
  const results: BackupProcessItemResult[] = [];

  for (const item of dueItems) {
    const record = recordById.get(item.record_id);
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

export async function importMissingRecordsFromDrive() {
  const [localRecords, response] = await Promise.all([loadAllRecords(), fetch("/api/backup/restore")]);
  const payload = (await response.json().catch(() => ({}))) as RestoreResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "RESTORE_FAILED");
  }

  const localIds = new Set(localRecords.map((record) => record.id));
  const imported: CGMPRecord[] = [];
  const skipped: DriveBackupRecord[] = [];

  for (const item of payload.records || []) {
    if (item.error || localIds.has(item.id) || !isRestorableRecord(item.record)) {
      skipped.push(item);
      continue;
    }

    const record: CGMPRecord = {
      ...item.record,
      backup_status: "backed_up",
      backup_retry_count: 0,
      backup_last_error: "",
      backup_next_retry_at: "",
      drive_file_id: item.file_id,
      last_backup_at: item.backed_up_at,
      backup_checksum: item.checksum,
    };
    await putRecordWithoutBackup(record);
    imported.push(record);
    localIds.add(record.id);
  }

  return {
    imported,
    skipped,
    totalRemote: payload.records?.length || 0,
  };
}
