import type { ImageVisionResult } from "@/types/image";

import { buildVisionFallback, sanitizeVisionResult } from "./sanitizeVisionResult";

export async function analyzeImageWithVision(previewBlob: Blob): Promise<ImageVisionResult> {
  const startedAt = performance.now();
  console.debug("[cgmp:image] analyze-image request started", {
    size: previewBlob.size,
    type: previewBlob.type,
  });

  const formData = new FormData();
  formData.append("image", previewBlob, "preview.jpg");
  formData.append("model", "gpt-4.1-nano");

  const response = await fetch("/api/analyze-image", {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
    detail?: string;
  };

  if (!response.ok || !payload.ok) {
    const message = payload.detail || payload.error || `ANALYZE_IMAGE_FAILED_${response.status}`;
    console.debug("[cgmp:image] vision analyze failed", {
      message,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    throw new Error(message);
  }

  const result = sanitizeVisionResult(payload.result);
  console.debug("[cgmp:image] vision analyze completed", {
    elapsedMs: Math.round(performance.now() - startedAt),
    result,
  });
  return result;
}

export function fallbackImageAnalysis(error: unknown) {
  return buildVisionFallback(error instanceof Error ? error.message : String(error || "vision_failed"));
}
