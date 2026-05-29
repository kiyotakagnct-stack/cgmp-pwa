"use client";

import type { ImageAttachment } from "@/types/image";

import { ImageAttachmentCard } from "./ImageAttachmentCard";

type ImageAttachmentGridProps = {
  attachments?: ImageAttachment[];
  compact?: boolean;
  maxItems?: number;
  onOpen?: (attachment: ImageAttachment, imageUrl: string) => void;
  onReanalyze?: (attachmentId: string) => void;
  onDelete?: (attachmentId: string) => void;
  onUpdateMetadata?: (
    attachmentId: string,
    patch: Pick<ImageAttachment, "summary_80" | "image_tags" | "visible_text">
  ) => void;
};

export function ImageAttachmentGrid({
  attachments = [],
  compact = false,
  maxItems,
  onOpen,
  onReanalyze,
  onDelete,
  onUpdateMetadata,
}: ImageAttachmentGridProps) {
  const images = attachments.filter((attachment) => attachment.type === "image");
  const visible = typeof maxItems === "number" ? images.slice(0, maxItems) : images;
  const remaining = images.length - visible.length;

  if (images.length === 0) return null;

  if (compact) {
    return (
      <div className="mt-4 flex flex-wrap gap-2">
        {visible.map((attachment) => (
          <ImageAttachmentCard key={attachment.id} attachment={attachment} compact onOpen={onOpen} />
        ))}
        {remaining > 0 ? (
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-500">
            +{remaining}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visible.map((attachment) => (
        <ImageAttachmentCard
          key={attachment.id}
          attachment={attachment}
          onOpen={onOpen}
          onReanalyze={onReanalyze}
          onDelete={onDelete}
          onUpdateMetadata={onUpdateMetadata}
        />
      ))}
    </div>
  );
}
