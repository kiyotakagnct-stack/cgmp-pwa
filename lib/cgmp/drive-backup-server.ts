import crypto from "node:crypto";

import type { CGMPRecord } from "./types";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const APP_DATA_SPACE = "appDataFolder";

type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
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
};

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
    scope: "https://www.googleapis.com/auth/drive.appdata",
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

async function getAccessToken() {
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
  const accessToken = await getAccessToken();
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

async function driveUpload<T>(path: string, metadata: Record<string, unknown>, body: string, mimeType: string, method = "POST") {
  const accessToken = await getAccessToken();
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

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findAppDataFile(name: string) {
  const q = `name = '${escapeDriveQuery(name)}' and '${APP_DATA_SPACE}' in parents and trashed = false`;
  const params = new URLSearchParams({
    spaces: APP_DATA_SPACE,
    fields: "files(id,name,modifiedTime)",
    q,
  });
  const payload = await driveFetch<{ files?: DriveFile[] }>(`/files?${params.toString()}`);
  return payload.files?.[0] || null;
}

async function readTextFile(fileId: string) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("GOOGLE_DRIVE_DOWNLOAD_FAILED");
  }

  return response.text();
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

async function upsertJsonFile(name: string, content: string) {
  const existing = await findAppDataFile(name);
  const metadata = existing
    ? { name }
    : {
        name,
        parents: [APP_DATA_SPACE],
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

async function loadManifest(): Promise<{ file: DriveFile | null; manifest: DriveManifest }> {
  const file = await findAppDataFile("manifest.json");
  if (!file) {
    return {
      file: null,
      manifest: {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        records: {},
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
    },
  };
}

export async function backupRecordToDrive(record: CGMPRecord) {
  const content = stableRecordPayload(record);
  const recordChecksum = checksum(content);
  const fileName = `record_${record.id}.json`;
  const recordFile = await upsertJsonFile(fileName, content);

  const backedUpAt = new Date().toISOString();
  const { manifest } = await loadManifest();
  manifest.updated_at = backedUpAt;
  manifest.records[record.id] = {
    file_id: recordFile.id,
    checksum: recordChecksum,
    updated_at: record.updated_at,
    backed_up_at: backedUpAt,
  };

  await upsertJsonFile("manifest.json", JSON.stringify(manifest, null, 2));

  return {
    driveFileId: recordFile.id,
    checksum: recordChecksum,
    backedUpAt,
  };
}

export async function listBackedUpRecords() {
  const { manifest } = await loadManifest();
  return manifest;
}

export async function listBackedUpRecordDetails() {
  const { manifest } = await loadManifest();
  const records = [];

  for (const [recordId, entry] of Object.entries(manifest.records)) {
    try {
      const text = await readTextFile(entry.file_id);
      const parsed = JSON.parse(text || "{}") as { record?: Partial<CGMPRecord> };
      const record = parsed.record || {};
      records.push({
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
      });
    } catch (error) {
      records.push({
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
      });
    }
  }

  return {
    manifest,
    records: records.sort((a, b) => String(b.backed_up_at).localeCompare(String(a.backed_up_at))),
  };
}
