"use client";

import { getImageBlob, putImageBlob } from "@/lib/db/imageBlobStore";
import type { ImageAttachment } from "@/types/image";

export class ImageHydrationError extends Error {
  status: number;
  fileId: string;
  code: string;
  detail: string;

  constructor({
    status,
    fileId,
    code,
    detail,
  }: {
    status: number;
    fileId: string;
    code: string;
    detail: string;
  }) {
    super(`${code}: ${detail}`);
    this.name = "ImageHydrationError";
    this.status = status;
    this.fileId = fileId;
    this.code = code;
    this.detail = detail;
  }
}

async function downloadDriveImageBlob(fileId: string) {
  const response = await fetch(`/api/backup/attachment?fileId=${encodeURIComponent(fileId)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const code = typeof payload?.error === "string" ? payload.error : "ATTACHMENT_DOWNLOAD_FAILED";
    const detail = typeof payload?.detail === "string" ? payload.detail : response.statusText || code;
    throw new ImageHydrationError({
      status: response.status,
      fileId,
      code,
      detail,
    });
  }
  return response.blob();
}

async function downloadVercelBlobImage(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new ImageHydrationError({
      status: response.status,
      fileId: url,
      code: "VERCEL_BLOB_IMAGE_DOWNLOAD_FAILED",
      detail: response.statusText || "Vercel Blob image download failed",
    });
  }
  return response.blob();
}

export async function getOrHydrateAttachmentImageBlob({
  attachment,
  compact = false,
}: {
  attachment: ImageAttachment;
  compact?: boolean;
}) {
  const candidates = compact
    ? [
        {
          key: attachment.thumbnailBlobKey,
          driveFileId: attachment.thumbnailDriveFileId,
          blobUrl: attachment.thumbnailBlobUrl,
        },
        {
          key: attachment.previewBlobKey,
          driveFileId: attachment.previewDriveFileId,
          blobUrl: attachment.previewBlobUrl,
        },
      ]
    : [
        {
          key: attachment.previewBlobKey,
          driveFileId: attachment.previewDriveFileId,
          blobUrl: attachment.previewBlobUrl,
        },
      ];

  let lastError: unknown = null;

  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const localBlob = await getImageBlob(candidate.key);
    if (localBlob) {
      return { blob: localBlob, hydrated: false, key: candidate.key };
    }
    if (!candidate.blobUrl && !candidate.driveFileId) continue;

    try {
      const remoteBlob = candidate.blobUrl
        ? await downloadVercelBlobImage(candidate.blobUrl)
        : await downloadDriveImageBlob(candidate.driveFileId || "");
      await putImageBlob(candidate.key, remoteBlob);
      return { blob: remoteBlob, hydrated: true, key: candidate.key };
    } catch (error) {
      lastError = error;
      console.debug("[cgmp:image] drive image hydration candidate failed", {
        attachmentId: attachment.id,
        key: candidate.key,
        driveFileId: candidate.driveFileId,
        blobUrl: candidate.blobUrl,
        error,
      });
    }
  }

  if (lastError) throw lastError;
  return { blob: null, hydrated: false, key: "" };
}
