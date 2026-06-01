import crypto from "node:crypto";

import { del, list, put } from "@vercel/blob";

import type { CGMPDeletedRecord, CGMPRecord } from "./types";
import type { ImageAttachment } from "@/types/image";

const ROOT_PREFIX = "cgmp";
const RECORDS_PREFIX = `${ROOT_PREFIX}/records`;
const ATTACHMENTS_PREFIX = `${ROOT_PREFIX}/attachments`;
const TOMBSTONES_PREFIX = `${ROOT_PREFIX}/tombstones`;

type BlobRecordEntry = {
  id: string;
  pathname: string;
  url: string;
  uploaded_at: string;
  record?: Partial<CGMPRecord>;
  error?: string;
};

type BlobTombstoneEntry = {
  id: string;
  pathname: string;
  url: string;
  uploaded_at: string;
  tombstone?: CGMPDeletedRecord;
  error?: string;
};

function sanitizePathComponent(value: string) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 160);
}

function recordPath(recordId: string) {
  return `${RECORDS_PREFIX}/record_${sanitizePathComponent(recordId)}.json`;
}

function tombstonePath(recordId: string) {
  return `${TOMBSTONES_PREFIX}/record_${sanitizePathComponent(recordId)}.json`;
}

function attachmentPath(recordId: string, attachmentId: string, variant: "preview" | "thumbnail") {
  return `${ATTACHMENTS_PREFIX}/${sanitizePathComponent(recordId)}/${sanitizePathComponent(attachmentId)}/${variant}.jpg`;
}

function checksumBuffer(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function checksumText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function listAllBlobs(prefix: string) {
  const blobs = [];
  let cursor: string | undefined;
  do {
    const result = await list({
      prefix,
      cursor,
      limit: 1000,
    });
    blobs.push(...result.blobs);
    cursor = result.cursor;
  } while (cursor);
  return blobs;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`BLOB_JSON_FETCH_FAILED_${response.status}`);
  }
  return (await response.json()) as T;
}

export async function saveRecordToVercelBlob(record: CGMPRecord) {
  const now = new Date().toISOString();
  const payload = JSON.stringify(record, null, 2);
  const blob = await put(recordPath(record.id), payload, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });

  return {
    blobPathname: blob.pathname,
    blobUrl: blob.url,
    checksum: checksumText(payload),
    backedUpAt: now,
  };
}

export async function saveDeletedRecordToVercelBlob(tombstone: CGMPDeletedRecord) {
  const now = new Date().toISOString();
  const payload = JSON.stringify(tombstone, null, 2);
  const blob = await put(tombstonePath(tombstone.record_id), payload, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });

  return {
    blobPathname: blob.pathname,
    blobUrl: blob.url,
    checksum: checksumText(payload),
    backedUpAt: now,
  };
}

export async function uploadAttachmentToVercelBlob({
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
  const previewBlob = await put(attachmentPath(recordId, attachment.id, "preview"), preview, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/jpeg",
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });

  let thumbnailBlob:
    | {
        pathname: string;
        url: string;
        downloadUrl: string;
      }
    | null = null;
  let checksum = checksumBuffer(preview);

  if (thumbnail && thumbnail.length > 0) {
    const uploadedThumbnail = await put(attachmentPath(recordId, attachment.id, "thumbnail"), thumbnail, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "image/jpeg",
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    thumbnailBlob = uploadedThumbnail;
    checksum = checksumBuffer(Buffer.concat([preview, thumbnail]));
  }

  return {
    previewBlobPathname: previewBlob.pathname,
    previewBlobUrl: previewBlob.url,
    previewBlobDownloadUrl: previewBlob.downloadUrl,
    thumbnailBlobPathname: thumbnailBlob?.pathname || "",
    thumbnailBlobUrl: thumbnailBlob?.url || "",
    thumbnailBlobDownloadUrl: thumbnailBlob?.downloadUrl || "",
    checksum,
    backedUpAt: new Date().toISOString(),
  };
}

export async function listVercelBlobRecords() {
  const [recordBlobs, tombstoneBlobs] = await Promise.all([
    listAllBlobs(`${RECORDS_PREFIX}/`),
    listAllBlobs(`${TOMBSTONES_PREFIX}/`),
  ]);

  const records: BlobRecordEntry[] = await Promise.all(
    recordBlobs
      .filter((blob) => blob.pathname.endsWith(".json"))
      .map(async (blob) => {
        try {
          const record = await fetchJson<CGMPRecord>(blob.url);
          return {
            id: record.id || blob.pathname,
            pathname: blob.pathname,
            url: blob.url,
            uploaded_at: blob.uploadedAt.toISOString(),
            record,
          };
        } catch (error) {
          return {
            id: blob.pathname,
            pathname: blob.pathname,
            url: blob.url,
            uploaded_at: blob.uploadedAt.toISOString(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
  );

  const tombstones: BlobTombstoneEntry[] = await Promise.all(
    tombstoneBlobs
      .filter((blob) => blob.pathname.endsWith(".json"))
      .map(async (blob) => {
        try {
          const tombstone = await fetchJson<CGMPDeletedRecord>(blob.url);
          return {
            id: tombstone.record_id || blob.pathname,
            pathname: blob.pathname,
            url: blob.url,
            uploaded_at: blob.uploadedAt.toISOString(),
            tombstone,
          };
        } catch (error) {
          return {
            id: blob.pathname,
            pathname: blob.pathname,
            url: blob.url,
            uploaded_at: blob.uploadedAt.toISOString(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
  );

  return { records, tombstones };
}

export async function deleteVercelBlobRecordFiles(recordId: string) {
  const prefix = `${ATTACHMENTS_PREFIX}/${sanitizePathComponent(recordId)}/`;
  const attachmentBlobs = await listAllBlobs(prefix);
  const targets = [recordPath(recordId), ...attachmentBlobs.map((blob) => blob.pathname)];
  if (targets.length > 0) {
    await del(targets);
  }
}
