"use client";

import { useEffect, useState } from "react";

import { getImageBlob } from "@/lib/db/imageBlobStore";
import type { ImageAttachment } from "@/types/image";

type ImageAttachmentCardProps = {
  attachment: ImageAttachment;
  compact?: boolean;
  onOpen?: (attachment: ImageAttachment, imageUrl: string) => void;
  onReanalyze?: (attachmentId: string) => void;
  onDelete?: (attachmentId: string) => void;
  onUpdateMetadata?: (
    attachmentId: string,
    patch: Pick<ImageAttachment, "summary_80" | "image_tags" | "visible_text">
  ) => void;
};

function statusLabel(status: ImageAttachment["analysis_status"]) {
  if (status === "done") return "解析済み";
  if (status === "analyzing") return "解析中";
  if (status === "failed") return "解析失敗";
  if (status === "pending") return "解析待ち";
  return "スキップ";
}

function statusClass(status: ImageAttachment["analysis_status"]) {
  if (status === "done") return "border-teal-200 bg-teal-50 text-teal-700";
  if (status === "analyzing") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "pending") return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function backupLabel(status: ImageAttachment["backup_status"]) {
  if (status === "backed_up") return "写真同期済み";
  if (status === "backing_up") return "写真同期中";
  if (status === "pending_backup") return "写真同期待ち";
  if (status === "backup_failed") return "写真同期失敗";
  if (status === "conflicted") return "写真競合";
  return "写真未同期";
}

function backupClass(status: ImageAttachment["backup_status"]) {
  if (status === "backed_up") return "border-teal-200 bg-teal-50 text-teal-700";
  if (status === "backing_up") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "pending_backup") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "backup_failed" || status === "conflicted") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

export function ImageAttachmentCard({
  attachment,
  compact = false,
  onOpen,
  onReanalyze,
  onDelete,
  onUpdateMetadata,
}: ImageAttachmentCardProps) {
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    let revoked = false;
    let objectUrl = "";

    void (async () => {
      const blob = await getImageBlob(compact ? attachment.thumbnailBlobKey || attachment.previewBlobKey : attachment.previewBlobKey);
      if (!blob || revoked) return;
      objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
    })();

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.previewBlobKey, attachment.thumbnailBlobKey]);

  if (compact) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (imageUrl) onOpen?.(attachment, imageUrl);
        }}
        className="relative h-20 w-20 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
        aria-label="添付画像を開く"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={attachment.summary_80 || "添付画像"} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-slate-400">image</span>
        )}
      </button>
    );
  }

  const canAnalyze = attachment.analysis_status === "failed" || attachment.analysis_status === "pending";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <button
        type="button"
        onClick={() => {
          if (imageUrl) onOpen?.(attachment, imageUrl);
        }}
        className="block w-full overflow-hidden rounded-xl border border-slate-100 bg-slate-100"
        aria-label="添付画像を拡大表示"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={attachment.summary_80 || "添付画像"} className="max-h-72 w-full object-contain" />
        ) : (
          <span className="flex h-36 w-full items-center justify-center text-sm text-slate-400">画像を読み込み中...</span>
        )}
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs ${statusClass(attachment.analysis_status)}`}>
          {statusLabel(attachment.analysis_status)}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-xs ${backupClass(attachment.backup_status)}`}>
          {backupLabel(attachment.backup_status)}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
          {attachment.image_type}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
          {attachment.confidence}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {attachment.summary_80 || "画像を添付しました。"}
      </p>

      {attachment.image_tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachment.image_tags.map((tag) => (
            <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      {attachment.visible_text ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{attachment.visible_text}</p>
      ) : null}

      {attachment.error && attachment.analysis_status === "failed" ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-rose-600">{attachment.error}</p>
      ) : null}
      {attachment.backup_last_error && attachment.backup_status === "backup_failed" ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-rose-600">{attachment.backup_last_error}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {canAnalyze ? (
          <button
            type="button"
            onClick={() => onReanalyze?.(attachment.id)}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
            disabled={attachment.analysis_status === "analyzing"}
          >
            {attachment.analysis_status === "pending" ? "解析実行" : "再解析"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onDelete?.(attachment.id)}
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          削除
        </button>
      </div>

      {onUpdateMetadata ? (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <label className="block text-xs font-medium text-slate-500">
            画像要約
            <input
              defaultValue={attachment.summary_80}
              onBlur={(event) =>
                onUpdateMetadata(attachment.id, {
                  summary_80: event.target.value,
                  image_tags: attachment.image_tags,
                  visible_text: attachment.visible_text,
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            画像タグ
            <input
              defaultValue={attachment.image_tags.join(" ")}
              onBlur={(event) =>
                onUpdateMetadata(attachment.id, {
                  summary_80: attachment.summary_80,
                  image_tags: event.target.value
                    .split(/[\n,，、\s]+/)
                    .map((tag) => tag.trim().replace(/^#+/, ""))
                    .filter(Boolean)
                    .slice(0, 5),
                  visible_text: attachment.visible_text,
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            画像内テキスト
            <textarea
              defaultValue={attachment.visible_text}
              rows={2}
              onBlur={(event) =>
                onUpdateMetadata(attachment.id, {
                  summary_80: attachment.summary_80,
                  image_tags: attachment.image_tags,
                  visible_text: event.target.value,
                })
              }
              className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
