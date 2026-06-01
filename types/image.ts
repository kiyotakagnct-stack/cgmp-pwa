export type ImageAnalysisStatus = "pending" | "analyzing" | "done" | "failed" | "skipped";

export type ImageType = "screenshot" | "document" | "whiteboard" | "object" | "scene" | "other";

export type ImageConfidence = "high" | "medium" | "low";

export type ImageBackupStatus =
  | "local_only"
  | "pending_backup"
  | "backing_up"
  | "backed_up"
  | "backup_failed"
  | "conflicted";

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
  backup_status?: ImageBackupStatus;
  backup_retry_count?: number;
  backup_last_error?: string;
  backup_next_retry_at?: string;
  previewDriveFileId?: string;
  thumbnailDriveFileId?: string;
  previewBlobPathname?: string;
  previewBlobUrl?: string;
  previewBlobDownloadUrl?: string;
  thumbnailBlobPathname?: string;
  thumbnailBlobUrl?: string;
  thumbnailBlobDownloadUrl?: string;
  blob_uploaded_at?: string;
  blob_upload_status?: ImageBackupStatus;
  blob_upload_error?: string;
  last_backup_at?: string;
  backup_checksum?: string;
  error?: string;
};
