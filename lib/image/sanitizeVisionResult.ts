import type { ImageConfidence, ImageType, ImageVisionResult } from "@/types/image";

const IMAGE_TYPES: ImageType[] = ["screenshot", "document", "whiteboard", "object", "scene", "other"];
const CONFIDENCES: ImageConfidence[] = ["high", "medium", "low"];

export function sanitizeImageType(value: unknown): ImageType {
  const normalized = String(value || "").trim().toLowerCase();
  return IMAGE_TYPES.includes(normalized as ImageType) ? (normalized as ImageType) : "other";
}

export function sanitizeConfidence(value: unknown): ImageConfidence {
  const normalized = String(value || "").trim().toLowerCase();
  return CONFIDENCES.includes(normalized as ImageConfidence) ? (normalized as ImageConfidence) : "medium";
}

export function sanitizeImageTags(value: unknown) {
  const rawTags = Array.isArray(value) ? value : String(value || "").split(/[\n,，、\s]+/);
  const seen = new Set<string>();

  return rawTags
    .map((item) => String(item || "").trim().replace(/^#+/, ""))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

export function sanitizeVisionResult(raw: unknown): ImageVisionResult {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result: ImageVisionResult = {
    image_type: sanitizeImageType(source.image_type),
    summary_80: String(source.summary_80 || "").trim().slice(0, 120),
    image_tags: sanitizeImageTags(source.image_tags),
    visible_text: String(source.visible_text || "").trim().slice(0, 180),
    confidence: sanitizeConfidence(source.confidence),
  };

  if (source.error) {
    result.error = String(source.error);
  }

  return result;
}

export function buildVisionFallback(errorText?: string): ImageVisionResult {
  return {
    image_type: "other",
    summary_80: "画像を添付しました。",
    image_tags: [],
    visible_text: "",
    confidence: "low",
    error: String(errorText || "vision_failed"),
  };
}
