import crypto from "node:crypto";

import type { CGMPDeletedRecord, CGMPRecord } from "./types";
import type { ImageAttachment } from "@/types/image";
import {
  createDefaultPromptConfig,
  normalizePromptConfig,
  type CGMPPromptConfigFile,
} from "./prompt-config";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const APP_DATA_SPACE = "appDataFolder";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_BACKUP_FOLDER_NAME = "CGMP_Backup";
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  mimeType?: string;
};

type DriveBackupTarget = {
  mode: "appdata" | "drive";
  manifestParentId: string;
  recordsParentId: string;
  attachmentsParentId: string;
  tombstonesParentId: string;
  snapshotsParentId: string;
  rootFolderId?: string;
};

type DriveManifest = {
  schema_version: 1;
  updated_at: string;
  records: Record<
    string,
    {
      file_id: string;
      checksum: string;
      updated_at: string;
      backed_up_at: string;
    }
  >;
  attachments?: Record<
    string,
    {
      record_id: string;
      attachment_id: string;
      preview_file_id: string;
      thumbnail_file_id: string;
      checksum: string;
      updated_at: string;
      backed_up_at: string;
    }
  >;
  deleted_records?: Record<string, CGMPDeletedRecord>;
};

export class GoogleDriveDownloadError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`GOOGLE_DRIVE_DOWNLOAD_FAILED (${status}): ${detail}`);
    this.name = "GoogleDriveDownloadError";
    this.status = status;
    this.detail = detail;
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
}

export function getGoogleAuthUrl() {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requiredEnv("GOOGLE_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "GOOGLE_TOKEN_EXCHANGE_FAILED");
  }

  return payload as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type: string;
  };
}

export async function getGoogleAccessToken() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (!refreshToken) throw new Error("GOOGLE_REFRESH_TOKEN_NOT_CONFIGURED");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new Error(typeof payload?.error === "string" ? payload.error : "GOOGLE_TOKEN_REFRESH_FAILED");
  }

  return payload.access_token as string;
}

async function driveFetch<T>(path: string, init: RequestInit = {}) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "GOOGLE_DRIVE_REQUEST_FAILED");
  }

  return payload as T;
}

async function driveJson<T>(path: string, init: RequestInit = {}) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "GOOGLE_DRIVE_REQUEST_FAILED");
  }

  return payload as T;
}

async function driveUpload<T>(path: string, metadata: Record<string, unknown>, body: string, mimeType: string, method = "POST") {
  const accessToken = await getGoogleAccessToken();
  const boundary = `cgmp_${crypto.randomUUID().replace(/-/g, "")}`;
  const multipartBody = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "",
    body,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch(`${DRIVE_UPLOAD_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "GOOGLE_DRIVE_UPLOAD_FAILED");
  }

  return payload as T;
}

async function driveUploadBuffer<T>(
  path: string,
  metadata: Record<string, unknown>,
  body: Buffer,
  mimeType: string,
  method = "POST"
) {
  const accessToken = await getGoogleAccessToken();
  const boundary = `cgmp_${crypto.randomUUID().replace(/-/g, "")}`;
  const head = Buffer.from(
    [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      "",
    ].join("\r\n") + "\r\n"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  const response = await fetch(`${DRIVE_UPLOAD_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: Buffer.concat([head, body, tail]),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "GOOGLE_DRIVE_UPLOAD_FAILED");
  }

  return payload as T;
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFileInParent(
  name: string,
  parentId: string,
  options: { spaces?: string; mimeType?: string } = {}
) {
  const mimeQuery = options.mimeType ? ` and mimeType = '${escapeDriveQuery(options.mimeType)}'` : "";
  const q = `name = '${escapeDriveQuery(name)}' and '${escapeDriveQuery(parentId)}' in parents and trashed = false${mimeQuery}`;
  const params = new URLSearchParams({
    fields: "files(id,name,mimeType,modifiedTime)",
    q,
  });
  if (options.spaces) params.set("spaces", options.spaces);
  const payload = await driveFetch<{ files?: DriveFile[] }>(`/files?${params.toString()}`);
  return payload.files?.[0] || null;
}

async function createFolder(name: string, parentId?: string) {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: DRIVE_FOLDER_MIME,
  };
  if (parentId) metadata.parents = [parentId];
  return driveJson<DriveFile>("/files?fields=id,name,mimeType,modifiedTime", {
    method: "POST",
    body: JSON.stringify(metadata),
  });
}

async function ensureFolder(name: string, parentId?: string) {
  const parent = parentId || "root";
  const existing = await findFileInParent(name, parent, { mimeType: DRIVE_FOLDER_MIME });
  if (existing) return existing;
  return createFolder(name, parentId);
}

let driveBackupTargetCache: Promise<DriveBackupTarget> | null = null;

function getBackupMode() {
  const mode = String(process.env.GOOGLE_DRIVE_BACKUP_MODE || "").trim().toLowerCase();
  if (mode === "drive") return "drive";
  if (mode === "appdata") return "appdata";
  return process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID?.trim() ? "drive" : "appdata";
}

async function resolveDriveBackupTarget(): Promise<DriveBackupTarget> {
  const mode = getBackupMode();
  if (mode === "appdata") {
    return {
      mode: "appdata",
      manifestParentId: APP_DATA_SPACE,
      recordsParentId: APP_DATA_SPACE,
      attachmentsParentId: APP_DATA_SPACE,
      tombstonesParentId: APP_DATA_SPACE,
      snapshotsParentId: APP_DATA_SPACE,
    };
  }

  const configuredRootId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID?.trim();
  const rootFolder = configuredRootId
    ? { id: configuredRootId, name: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_NAME || DEFAULT_BACKUP_FOLDER_NAME }
    : await ensureFolder(process.env.GOOGLE_DRIVE_BACKUP_FOLDER_NAME || DEFAULT_BACKUP_FOLDER_NAME);
  const [recordsFolder, attachmentsFolder, tombstonesFolder, snapshotsFolder] = await Promise.all([
    ensureFolder("records", rootFolder.id),
    ensureFolder("attachments", rootFolder.id),
    ensureFolder("tombstones", rootFolder.id),
    ensureFolder("snapshots", rootFolder.id),
  ]);

  return {
    mode: "drive",
    rootFolderId: rootFolder.id,
    manifestParentId: rootFolder.id,
    recordsParentId: recordsFolder.id,
    attachmentsParentId: attachmentsFolder.id,
    tombstonesParentId: tombstonesFolder.id,
    snapshotsParentId: snapshotsFolder.id,
  };
}

async function getDriveBackupTarget() {
  driveBackupTargetCache ||= resolveDriveBackupTarget();
  return driveBackupTargetCache;
}

async function readTextFile(fileId: string) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("GOOGLE_DRIVE_DOWNLOAD_FAILED");
  }

  return response.text();
}

export async function downloadDriveFileBuffer(fileId: string) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleDriveDownloadError(response.status, text.slice(0, 500) || response.statusText);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

function stableRecordPayload(record: CGMPRecord) {
  const {
    backup_status: _backupStatus,
    backup_retry_count: _backupRetryCount,
    backup_last_error: _backupLastError,
    backup_next_retry_at: _backupNextRetryAt,
    drive_file_id: _driveFileId,
    last_backup_at: _lastBackupAt,
    backup_checksum: _backupChecksum,
    ...recordContent
  } = record;

  return JSON.stringify(
    {
      schema_version: 1,
      kind: "cgmp_record",
      backed_up_format: "record_json",
      record: recordContent,
    },
    null,
    2
  );
}

function checksum(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function checksumBuffer(value: Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function upsertJsonFile(
  name: string,
  content: string,
  parentId: string,
  knownFile?: DriveFile | null
) {
  const existing =
    knownFile === undefined
      ? await findFileInParent(name, parentId, { spaces: parentId === APP_DATA_SPACE ? APP_DATA_SPACE : undefined })
      : knownFile;
  const metadata = existing
    ? { name }
    : {
        name,
        parents: [parentId],
      };

  if (existing) {
    return driveUpload<DriveFile>(
      `/files/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,name,modifiedTime`,
      metadata,
      content,
      "application/json",
      "PATCH"
    );
  }

  return driveUpload<DriveFile>(
    "/files?uploadType=multipart&fields=id,name,modifiedTime",
    metadata,
    content,
    "application/json"
  );
}

async function upsertBinaryFile(
  name: string,
  content: Buffer,
  mimeType: string,
  parentId: string,
  knownFile?: DriveFile | null
) {
  const existing =
    knownFile === undefined
      ? await findFileInParent(name, parentId, { spaces: parentId === APP_DATA_SPACE ? APP_DATA_SPACE : undefined })
      : knownFile;
  const metadata = existing
    ? { name }
    : {
        name,
        parents: [parentId],
      };

  if (existing) {
    return driveUploadBuffer<DriveFile>(
      `/files/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,name,modifiedTime`,
      metadata,
      content,
      mimeType,
      "PATCH"
    );
  }

  return driveUploadBuffer<DriveFile>(
    "/files?uploadType=multipart&fields=id,name,modifiedTime",
    metadata,
    content,
    mimeType
  );
}

async function loadManifest(): Promise<{ file: DriveFile | null; manifest: DriveManifest }> {
  const target = await getDriveBackupTarget();
  const file = await findFileInParent("manifest.json", target.manifestParentId, {
    spaces: target.mode === "appdata" ? APP_DATA_SPACE : undefined,
  });
  if (!file) {
    return {
      file: null,
      manifest: {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        records: {},
        attachments: {},
        deleted_records: {},
      },
    };
  }

  const text = await readTextFile(file.id);
  const parsed = JSON.parse(text || "{}") as Partial<DriveManifest>;
  return {
    file,
    manifest: {
      schema_version: 1,
      updated_at: String(parsed.updated_at || new Date().toISOString()),
      records: parsed.records && typeof parsed.records === "object" ? parsed.records : {},
      attachments: parsed.attachments && typeof parsed.attachments === "object" ? parsed.attachments : {},
      deleted_records:
        parsed.deleted_records && typeof parsed.deleted_records === "object"
          ? (parsed.deleted_records as Record<string, CGMPDeletedRecord>)
          : {},
    },
  };
}

function knownDriveFile(id: string | undefined, name: string): DriveFile | undefined {
  const fileId = String(id || "").trim();
  return fileId ? { id: fileId, name } : undefined;
}

async function upsertJsonFileWithFallback(
  name: string,
  content: string,
  parentId: string,
  knownFile?: DriveFile | null
) {
  if (!knownFile) return upsertJsonFile(name, content, parentId);
  try {
    return await upsertJsonFile(name, content, parentId, knownFile);
  } catch (error) {
    console.debug("[cgmp:drive] known json file id failed, falling back to name lookup", {
      name,
      fileId: knownFile.id,
      error,
    });
    return upsertJsonFile(name, content, parentId);
  }
}

async function upsertBinaryFileWithFallback(
  name: string,
  content: Buffer,
  mimeType: string,
  parentId: string,
  knownFile?: DriveFile | null
) {
  if (!knownFile) return upsertBinaryFile(name, content, mimeType, parentId);
  try {
    return await upsertBinaryFile(name, content, mimeType, parentId, knownFile);
  } catch (error) {
    console.debug("[cgmp:drive] known binary file id failed, falling back to name lookup", {
      name,
      fileId: knownFile.id,
      error,
    });
    return upsertBinaryFile(name, content, mimeType, parentId);
  }
}

export async function backupDeletedRecordToDrive(tombstone: CGMPDeletedRecord) {
  const backedUpAt = new Date().toISOString();
  const target = await getDriveBackupTarget();
  const { file, manifest } = await loadManifest();
  const tombstoneFileName = `tombstone_${sanitizeFileComponent(tombstone.record_id)}.json`;
  const tombstonePayload = JSON.stringify(
    {
      schema_version: 1,
      kind: "cgmp_deleted_record",
      tombstone: {
        ...tombstone,
        schema_version: 1,
        deleted_at: tombstone.deleted_at || backedUpAt,
      },
    },
    null,
    2
  );
  const tombstoneFile = await upsertJsonFileWithFallback(
    tombstoneFileName,
    tombstonePayload,
    target.tombstonesParentId,
    knownDriveFile(tombstone.drive_file_id, tombstoneFileName)
  );
  manifest.updated_at = backedUpAt;
  manifest.deleted_records = manifest.deleted_records || {};
  manifest.deleted_records[tombstone.record_id] = {
    ...tombstone,
    schema_version: 1,
    deleted_at: tombstone.deleted_at || backedUpAt,
    drive_file_id: tombstoneFile.id,
  };
  await upsertJsonFile("manifest.json", JSON.stringify(manifest, null, 2), target.manifestParentId, file);
  return { backedUpAt };
}

export async function backupRecordToDrive(record: CGMPRecord) {
  const target = await getDriveBackupTarget();
  const content = stableRecordPayload(record);
  const recordChecksum = checksum(content);
  const fileName = `record_${record.id}.json`;
  const recordFile = await upsertJsonFileWithFallback(
    fileName,
    content,
    target.recordsParentId,
    knownDriveFile(record.drive_file_id, fileName)
  );

  const backedUpAt = new Date().toISOString();
  const { file, manifest } = await loadManifest();
  manifest.updated_at = backedUpAt;
  manifest.records[record.id] = {
    file_id: recordFile.id,
    checksum: recordChecksum,
    updated_at: record.updated_at,
    backed_up_at: backedUpAt,
  };

  await upsertJsonFile("manifest.json", JSON.stringify(manifest, null, 2), target.manifestParentId, file);

  return {
    driveFileId: recordFile.id,
    checksum: recordChecksum,
    backedUpAt,
  };
}

function sanitizeFileComponent(value: string) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "attachment";
}

export async function backupAttachmentToDrive({
  recordId,
  attachment,
  preview,
  thumbnail,
}: {
  recordId: string;
  attachment: ImageAttachment;
  preview: Buffer;
  thumbnail?: Buffer | null;
}) {
  const target = await getDriveBackupTarget();
  const safeRecordId = sanitizeFileComponent(recordId);
  const safeAttachmentId = sanitizeFileComponent(attachment.id);
  const previewFileName = `attachment_${safeRecordId}_${safeAttachmentId}_preview.jpg`;
  const previewFile = await upsertBinaryFileWithFallback(
    previewFileName,
    preview,
    "image/jpeg",
    target.attachmentsParentId,
    knownDriveFile(attachment.previewDriveFileId, previewFileName)
  );
  let thumbnailFileId = "";
  let attachmentChecksum = checksumBuffer(preview);

  if (thumbnail && thumbnail.length > 0) {
    const thumbnailFileName = `attachment_${safeRecordId}_${safeAttachmentId}_thumbnail.jpg`;
    const thumbnailFile = await upsertBinaryFileWithFallback(
      thumbnailFileName,
      thumbnail,
      "image/jpeg",
      target.attachmentsParentId,
      knownDriveFile(attachment.thumbnailDriveFileId, thumbnailFileName)
    );
    thumbnailFileId = thumbnailFile.id;
    attachmentChecksum = checksumBuffer(Buffer.concat([preview, thumbnail]));
  }

  const backedUpAt = new Date().toISOString();
  const { file, manifest } = await loadManifest();
  manifest.updated_at = backedUpAt;
  manifest.attachments = manifest.attachments || {};
  manifest.attachments[`${recordId}:${attachment.id}`] = {
    record_id: recordId,
    attachment_id: attachment.id,
    preview_file_id: previewFile.id,
    thumbnail_file_id: thumbnailFileId,
    checksum: attachmentChecksum,
    updated_at: backedUpAt,
    backed_up_at: backedUpAt,
  };

  await upsertJsonFile("manifest.json", JSON.stringify(manifest, null, 2), target.manifestParentId, file);

  return {
    previewDriveFileId: previewFile.id,
    thumbnailDriveFileId: thumbnailFileId,
    checksum: attachmentChecksum,
    backedUpAt,
  };
}

export async function listBackedUpRecords() {
  const { manifest } = await loadManifest();
  return manifest;
}

type ListBackedUpRecordDetailsOptions = {
  knownRecordChecksums?: Record<string, string>;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function listBackedUpRecordDetails(options: ListBackedUpRecordDetailsOptions = {}) {
  const { manifest } = await loadManifest();
  const entries = Object.entries(manifest.records);
  const records = await mapWithConcurrency(entries, 8, async ([recordId, entry]) => {
    const knownChecksum = options.knownRecordChecksums?.[recordId];
    if (knownChecksum && knownChecksum === entry.checksum) {
      return {
        id: recordId,
        title: "同期済み",
        summary: "",
        action: "",
        domain: "",
        para: "",
        updated_at: entry.updated_at,
        backed_up_at: entry.backed_up_at,
        checksum: entry.checksum,
        file_id: entry.file_id,
        unchanged: true,
      };
    }

    try {
      const text = await readTextFile(entry.file_id);
      const parsed = JSON.parse(text || "{}") as { record?: Partial<CGMPRecord> };
      const record = parsed.record || {};
      return {
        id: recordId,
        title: String(record.title || "（無題）"),
        summary: String(record.summary || record.body || record.raw_input || ""),
        action: String(record.action || "note"),
        domain: String(record.domain || "other"),
        para: String(record.para || "area"),
        updated_at: String(record.updated_at || entry.updated_at || ""),
        backed_up_at: entry.backed_up_at,
        checksum: entry.checksum,
        file_id: entry.file_id,
        record,
      };
    } catch (error) {
      return {
        id: recordId,
        title: "読み込み失敗",
        summary: error instanceof Error ? error.message : "GOOGLE_DRIVE_RECORD_READ_FAILED",
        action: "",
        domain: "",
        para: "",
        updated_at: entry.updated_at,
        backed_up_at: entry.backed_up_at,
        checksum: entry.checksum,
        file_id: entry.file_id,
        error: true,
      };
    }
  });

  return {
    manifest,
    records: records.sort((a, b) => String(b.backed_up_at).localeCompare(String(a.backed_up_at))),
  };
}

export async function loadPromptConfigFromDrive(): Promise<CGMPPromptConfigFile> {
  const target = await getDriveBackupTarget();
  const file = await findFileInParent("prompts.json", target.manifestParentId, {
    spaces: target.mode === "appdata" ? APP_DATA_SPACE : undefined,
  });
  if (!file) return createDefaultPromptConfig();
  const text = await readTextFile(file.id);
  return normalizePromptConfig(JSON.parse(text || "{}"));
}

export async function savePromptConfigToDrive(config: CGMPPromptConfigFile) {
  const target = await getDriveBackupTarget();
  const normalized = normalizePromptConfig({
    ...config,
    updated_at: new Date().toISOString(),
  });
  const file = await findFileInParent("prompts.json", target.manifestParentId, {
    spaces: target.mode === "appdata" ? APP_DATA_SPACE : undefined,
  });
  const saved = await upsertJsonFile(
    "prompts.json",
    JSON.stringify(normalized, null, 2),
    target.manifestParentId,
    file
  );
  return {
    config: normalized,
    fileId: saved.id,
    updatedAt: normalized.updated_at,
  };
}
