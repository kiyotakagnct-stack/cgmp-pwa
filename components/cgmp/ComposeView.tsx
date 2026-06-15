"use client";

import type { RefObject } from "react";

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

type ComposeViewProps = {
  draft: RecordFormState;
  loading: boolean;
  aiStatus: CGMPRecord["ai_status"];
  aiError: string;
  aiMeta: ComposeAiMeta;
  rawInputRef: RefObject<HTMLTextAreaElement | null>;
  confirmSectionRef: RefObject<HTMLElement | null>;
  onDraftChange: (patch: Partial<RecordFormState>) => void;
  onAnalyze: () => void;
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
  rawInputRef,
  confirmSectionRef,
  onDraftChange,
  onAnalyze,
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
            placeholder="雑に入れたメモをそのまま貼る"
            rows={10}
            inputRef={rawInputRef}
          />

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

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onAnalyze} disabled={loading} className={primaryButtonClass}>
              {loading ? "解析中..." : "AI解析"}
            </button>
            <button type="button" onClick={onSaveWithoutAi} className={secondaryButtonClass}>
              AIなしで保存
            </button>
            <button type="button" onClick={onSaveDraft} className={secondaryButtonClass}>
              下書きとして保存
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
