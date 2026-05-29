"use client";

type ImageLightboxProps = {
  imageUrl: string;
  title?: string;
  onClose: () => void;
};

export function ImageLightbox({ imageUrl, title = "添付画像", onClose }: ImageLightboxProps) {
  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 pb-3 text-white">
          <div className="line-clamp-2 text-sm font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl transition hover:bg-white/25"
            aria-label="拡大画像を閉じる"
          >
            ×
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(event) => event.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={title} className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
        </div>
      </div>
    </div>
  );
}
