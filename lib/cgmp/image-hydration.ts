"use client";

import { getImageBlob, putImageBlob } from "@/lib/db/imageBlobStore";
import type { ImageAttachment } from "@/types/image";

async function downloadDriveImageBlob(fileId: string) {
  const response = await fetch(`/api/backup/attachment?fileId=${encodeURIComponent(fileId)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload?.detail === "string" ? payload.detail : "ATTACHMENT_DOWNLOAD_FAILED");
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
        },
        {
          key: attachment.previewBlobKey,
          driveFileId: attachment.previewDriveFileId,
        },
      ]
    : [
        {
          key: attachment.previewBlobKey,
          driveFileId: attachment.previewDriveFileId,
        },
      ];

  for (const candidate of candidates) {
    if (!candidate.key) continue;
    const localBlob = await getImageBlob(candidate.key);
    if (localBlob) {
      return { blob: localBlob, hydrated: false, key: candidate.key };
    }
    if (!candidate.driveFileId) continue;

    const driveBlob = await downloadDriveImageBlob(candidate.driveFileId);
    await putImageBlob(candidate.key, driveBlob);
    return { blob: driveBlob, hydrated: true, key: candidate.key };
  }

  return { blob: null, hydrated: false, key: "" };
}
