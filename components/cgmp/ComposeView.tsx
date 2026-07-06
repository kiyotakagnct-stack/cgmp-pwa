"use client";

import type { ClipboardEvent, RefObject } from "react";

import { RecordEditor } from "@/components/cgmp/RecordEditor";
import {
  Badge,
  LabeledTextarea,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  SectionHeading,
  softPanelClass,
} from "@/components/cgmp/ui";
import type { RecordFormState } from "@/lib/cgmp/client-utils";
import type { CGMPRecord } from "@/lib/cgmp/types";

type ComposeAiMeta = {
  model: string;
  generated_at: string;
} | null;

export type ComposePendingImage = {
  id: string;
  previewUrl: string;
  name: string;
  lineIndex: number | null;
  lineLabel: string;
};

type ComposeViewProps = {
  draft: RecordFormState;
  loading: boolean;
  aiStatus: CGMPRecord["ai_status"];
  aiError: string;
  aiMeta: ComposeAiMeta;
  multiMemoMode: boolean;
  pendingImages: ComposePendingImage[];
  rawInputRef: RefObject<HTMLTextAreaElement | null>;
  confirmSectionRef: RefObject<HTMLElement | null>;
  onDraftChange: (patch: Partial<RecordFormState>) => void;
  onMultiMemoModeChange: (enabled: boolean) => void;
  onPasteImages: (files: File[], selectionStart: number) => void;
  onRemovePendingImage: (id: string) => void;
  onAnalyze: () => void;
  onAnalyzeAndSave: () => void;
  onSave: () => void;
  onSaveWithoutAi: () => void;
  onSaveDraft: () => void;
  onClear: () => void;
  onGoHome: () => void;
};

const QUICK_INPUT_TOKENS = ["今日", "明日", "明後日", "メモ", "タスク", "予定"] as const;

export function ComposeView({
  draft,
  loading,
  aiStatus,
  aiError,
  aiMeta,
  multiMemoMode,
  pendingImages,
  rawInputRef,
  confirmSectionRef,
  onDraftChange,
  onMultiMemoModeChange,
  onPasteImages,
  onRemovePendingImage,
  onAnalyze,
  onAnalyzeAndSave,
  onSave,
  onSaveWithoutAi,
  onSaveDraft,
  onClear,
  onGoHome,
}: ComposeViewProps) {
  function insertQuickInputToken(token: (typeof QUICK_INPUT_TOKENS)[number]) {
    const textarea = rawInputRef.current;
    const currentValue = draft.raw_input ?? "";
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? start;
    const before = currentValue.slice(0, start);
    const after = currentValue.slice(end);
    const prefix = before && !/[\s　]$/.test(before) ? " " : "";
    const suffix = after && !/^[\s　]/.test(after) ? " " : "";
    const insertedText = `${prefix}${token}${suffix}`;
    const nextValue = `${before}${insertedText}${after}`;
    const nextCursorPosition = before.length + insertedText.length;

    onDraftChange({ raw_input: nextValue, body: draft.body || nextValue });

    window.requestAnimationFrame(() => {
      rawInputRef.current?.focus();
      rawInputRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  const multiMemoCount = draft.raw_input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const rawInputPlaceholder = multiMemoMode
    ? "1行ごとに1メモとして処理します"
    : "雑に入れたメモをそのまま貼る";

  function handleRawInputPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;

    onPasteImages(files, event.currentTarget.selectionStart ?? draft.raw_input.length);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <section className={panelClass}>
        <SectionHeading
          eyebrow="Compose"
          title="入力 → AI解析 → 確認"
        />

        <div className="space-y-4">
          <LabeledTextarea
            label="Raw input"
            value={draft.raw_input}
            onChange={(value) => onDraftChange({ raw_input: value, body: draft.body || value })}
            placeholder={rawInputPlaceholder}
            rows={10}
            inputRef={rawInputRef}
            onPaste={handleRawInputPaste}
          />

          {pendingImages.length > 0 ? (
            <div className="rounded-[22px] border border-[color:var(--border)] bg-[var(--card-soft)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Pasted images</div>
                <span className="text-xs font-semibold text-[var(--muted)]">
                  保存時に添付して画像AI解析します
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {pendingImages.map((image) => (
                  <div
                    key={image.id}
                    className="relative min-w-[96px] rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-2 shadow-sm"
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-20 w-20 rounded-xl object-cover"
                    />
                    <button
                      type="button"
                      aria-label="貼り付け画像を削除"
                      onClick={() => onRemovePendingImage(image.id)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--border)] bg-[var(--card)] text-xs font-bold text-[var(--text)] shadow-sm"
                    >
                      ×
                    </button>
                    <div className="mt-1 max-w-[84px] truncate text-[10px] font-semibold text-[var(--muted)]">
                      {image.lineLabel}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="-mt-1 flex flex-wrap gap-2" aria-label="Raw input quick insert">
            {QUICK_INPUT_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertQuickInputToken(token)}
                className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-[0.98]"
              >
                {token}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
            <button
              type="button"
              aria-pressed={multiMemoMode}
              onClick={() => onMultiMemoModeChange(!multiMemoMode)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-[0.98] ${
                multiMemoMode
                  ? "border-[color:var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "border-[color:var(--border)] bg-[var(--card)] text-[var(--text)] hover:border-[color:var(--accent)]"
              }`}
            >
              複数メモ {multiMemoMode ? "ON" : "OFF"}
            </button>
            <span className="text-xs font-semibold text-[var(--muted)]">
              {multiMemoMode ? `1行=1メモ / ${multiMemoCount}件` : "入力全体を1メモとして処理"}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAnalyze}
              disabled={loading || multiMemoMode}
              className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
              title={multiMemoMode ? "複数メモでは「AI解析して保存」を使ってください。" : undefined}
            >
              {loading ? "解析中..." : "AI解析"}
            </button>
            <button type="button" onClick={onAnalyzeAndSave} disabled={loading} className={primaryButtonClass}>
              {loading ? "解析中..." : multiMemoMode ? "一括AI解析して保存" : "AI解析して保存"}
            </button>
            <button type="button" onClick={onSaveWithoutAi} className={secondaryButtonClass}>
              {multiMemoMode ? "行ごとAIなし保存" : "AIなしで保存"}
            </button>
            <button type="button" onClick={onSaveDraft} className={secondaryButtonClass}>
              {multiMemoMode ? "行ごと下書き保存" : "下書きとして保存"}
            </button>
            <button type="button" onClick={onClear} className={secondaryButtonClass}>
              クリア
            </button>
          </div>

          <div className={softPanelClass}>
            <div className="text-sm font-medium text-[var(--text)]">AI状態</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge tone={aiStatus === "done" ? "emerald" : aiStatus === "error" ? "rose" : "slate"}>{aiStatus}</Badge>
              {aiMeta ? <Badge tone="cyan">{aiMeta.model}</Badge> : null}
              {aiError ? <span className="text-[var(--danger)]">{aiError}</span> : null}
            </div>
          </div>
        </div>
      </section>

      <section ref={confirmSectionRef} className={panelClass}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            eyebrow="Confirm"
            title="AI結果の確認・修正"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onSave} className={primaryButtonClass}>
              保存
            </button>
            <button type="button" onClick={onGoHome} className={secondaryButtonClass}>
              一覧へ
            </button>
          </div>
        </div>

        <div className="max-h-[74vh] overflow-auto pr-1">
          <RecordEditor draft={draft} onChange={onDraftChange} showRawInput={false} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={onSave} className={primaryButtonClass}>
            保存
          </button>
          <button type="button" onClick={onGoHome} className={secondaryButtonClass}>
            一覧へ戻る
          </button>
        </div>
      </section>
    </div>
  );
}
