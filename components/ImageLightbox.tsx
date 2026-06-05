"use client";

type ImageLightboxProps = {
  imageUrl: string;
  title?: string;
  onClose: () => void;
};

export function ImageLightbox({ imageUrl, title = "添付画像", onClose }: ImageLightboxProps) {
  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/80 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-[calc(env(safe-area-inset-top)+3.25rem)] backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full flex-col">
        <div className="pb-3 text-white">
          <div className="line-clamp-2 pr-2 text-sm font-semibold">{title}</div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(event) => event.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={title} className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="fixed left-1/2 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] flex h-12 -translate-x-1/2 items-center justify-center rounded-full bg-white/90 px-6 text-sm font-semibold text-slate-900 shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition hover:bg-white"
        aria-label="拡大画像を閉じる"
      >
        閉じる
      </button>
    </div>
  );
}
