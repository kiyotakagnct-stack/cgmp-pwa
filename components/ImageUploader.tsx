"use client";

import { useRef } from "react";

type ImageUploaderProps = {
  disabled?: boolean;
  processingCount?: number;
  onFilesSelected: (files: File[]) => void;
};

export function ImageUploader({ disabled = false, processingCount = 0, onFilesSelected }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 p-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          if (files.length > 0) onFilesSelected(files);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-600">
          {processingCount > 0 ? `${processingCount}枚を処理中...` : "写真をメモに添付"}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-blue-500 bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          写真を追加
        </button>
      </div>
    </div>
  );
}
