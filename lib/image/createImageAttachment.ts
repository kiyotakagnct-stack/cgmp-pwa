import type { ImageAttachment } from "@/types/image";

import { buildVisionFallback } from "./sanitizeVisionResult";
import { resizeImageToJpegBlob } from "./resizeImage";

export type PreparedImageAttachment = {
  attachment: ImageAttachment;
  previewBlob: Blob;
  thumbnailBlob?: Blob;
};

function jstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function generateImageAttachmentId(date = new Date()) {
  const parts = jstParts(date);
  const stamp = `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
  const rand = Math.random().toString(36).slice(2, 5).padEnd(3, "0");
  return `img_${stamp}_${rand}`;
}

export function buildImageBlobKey(recordId: string, attachmentId: string, variant: "preview" | "thumbnail") {
  return `imageBlobs/${recordId}/${attachmentId}/${variant}.jpg`;
}

export async function createImageAttachmentFromFile(
  recordId: string,
  file: File,
  options: { createThumbnail?: boolean } = {}
): Promise<PreparedImageAttachment> {
  const startedAt = performance.now();
  const attachmentId = generateImageAttachmentId();
  console.debug("[cgmp:image] photo add started", {
    recordId,
    attachmentId,
    name: file.name,
    size: file.size,
    type: file.type,
  });

  const preview = await resizeImageToJpegBlob(file, 960, 0.42);
  console.debug("[cgmp:image] preview resize completed", {
    recordId,
    attachmentId,
    width: preview.width,
    height: preview.height,
    size: preview.blob.size,
  });

  const thumbnail = options.createThumbnail ? await resizeImageToJpegBlob(file, 320, 0.5) : null;
  if (thumbnail) {
    console.debug("[cgmp:image] thumbnail resize completed", {
      recordId,
      attachmentId,
      width: thumbnail.width,
      height: thumbnail.height,
      size: thumbnail.blob.size,
    });
  }

  const fallback = buildVisionFallback("");
  const now = new Date().toISOString();
  const attachment: ImageAttachment = {
    id: attachmentId,
    type: "image",
    previewBlobKey: buildImageBlobKey(recordId, attachmentId, "preview"),
    thumbnailBlobKey: thumbnail ? buildImageBlobKey(recordId, attachmentId, "thumbnail") : undefined,
    originalFileName: file.name,
    mimeType: "image/jpeg",
    previewSizeBytes: preview.blob.size,
    thumbnailSizeBytes: thumbnail?.blob.size,
    previewWidth: preview.width,
    previewHeight: preview.height,
    thumbnailWidth: thumbnail?.width,
    thumbnailHeight: thumbnail?.height,
    created_at: now,
    image_type: fallback.image_type,
    summary_80: fallback.summary_80,
    image_tags: fallback.image_tags,
    visible_text: fallback.visible_text,
    confidence: fallback.confidence,
    analysis_status: "pending",
  };

  console.debug("[cgmp:image] attachment built", {
    recordId,
    attachmentId,
    elapsedMs: Math.round(performance.now() - startedAt),
  });

  return {
    attachment,
    previewBlob: preview.blob,
    thumbnailBlob: thumbnail?.blob,
  };
}
