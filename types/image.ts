export type ImageAnalysisStatus = "pending" | "analyzing" | "done" | "failed" | "skipped";

export type ImageType = "screenshot" | "document" | "whiteboard" | "object" | "scene" | "other";

export type ImageConfidence = "high" | "medium" | "low";

export type ImageVisionResult = {
  image_type: ImageType;
  summary_80: string;
  image_tags: string[];
  visible_text: string;
  confidence: ImageConfidence;
  error?: string;
};

export type ImageAttachment = {
  id: string;
  type: "image";
  previewBlobKey: string;
  thumbnailBlobKey?: string;
  originalFileName?: string;
  mimeType: "image/jpeg";
  previewSizeBytes?: number;
  thumbnailSizeBytes?: number;
  previewWidth?: number;
  previewHeight?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  created_at: string;
  image_type: ImageType;
  summary_80: string;
  image_tags: string[];
  visible_text: string;
  confidence: ImageConfidence;
  analysis_status: ImageAnalysisStatus;
  error?: string;
};
