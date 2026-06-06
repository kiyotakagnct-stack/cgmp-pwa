"use client";

import { primaryButtonClass, secondaryButtonClass } from "@/components/cgmp/ui";
import type { CGMPPromptConfigFile, CGMPPromptDefinition, CGMPPromptKey } from "@/lib/cgmp/prompt-config";

export type PromptEditorDefinition = Omit<CGMPPromptDefinition, "hiddenContract">;

type PromptSettingsModalProps = {
  open: boolean;
  definitions: PromptEditorDefinition[];
  configDraft: CGMPPromptConfigFile | null;
  loading: boolean;
  saving: boolean;
  error: string;
  activePromptKey: CGMPPromptKey;
  onActivePromptKeyChange: (key: CGMPPromptKey) => void;
  onClose: () => void;
  onReload: () => void;
  onSave: () => void;
  onResetActivePromptToDefault: () => void;
  onUpdatePromptDraft: (key: CGMPPromptKey, value: string) => void;
};

export function PromptSettingsModal({
  open,
  definitions,
  configDraft,
  loading,
  saving,
  error,
  activePromptKey,
  onActivePromptKeyChange,
  onClose,
  onReload,
  onSave,
  onResetActivePromptToDefault,
  onUpdatePromptDraft,
}: PromptSettingsModalProps) {
  if (!open) return null;

  const activeDefinition = definitions.find((item) => item.key === activePromptKey) || definitions[0] || null;
  const activePrompt = activeDefinition
    ? configDraft?.prompts?.[activeDefinition.key]?.userPrompt || activeDefinition.defaultUserPrompt
    : "";
  const activePromptRows = Math.min(42, Math.max(14, activePrompt.split("\n").length + 2));

  return (
    <div className="fixed inset-0 z-[96] overflow-y-auto overscroll-contain bg-white/70 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm dark:bg-slate-950/60 sm:px-4 sm:py-6">
      <section className="mx-auto my-2 w-full max-w-5xl rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-4 shadow-[0_28px_90px_var(--shadow-soft)] sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="section-eyebrow">Prompt Settings</div>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--text)]">AIプロンプト編集</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              ここではAIの判断方針だけを編集します。JSON形式・必須フィールド・余計な文章禁止などの出力制約は非表示で固定しています。
            </p>
          </div>
          <button type="button" onClick={onClose} className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}>
            閉じる
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-[color:var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-5 flex min-h-64 items-center justify-center rounded-3xl border border-[color:var(--border)] bg-[var(--card-soft)] text-sm text-[var(--muted)]">
            Google Driveからプロンプト設定を読み込み中...
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="max-h-72 space-y-2 overflow-auto rounded-3xl border border-[color:var(--border)] bg-[var(--card-soft)] p-2 overscroll-contain md:max-h-[64dvh]">
              {definitions.length > 0 ? (
                definitions.map((definition) => {
                  const isActive = activeDefinition?.key === definition.key;
                  return (
                    <button
                      key={definition.key}
                      type="button"
                      onClick={() => onActivePromptKeyChange(definition.key)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                        isActive
                          ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[var(--text)]"
                          : "border-transparent text-[var(--muted)] hover:border-[color:var(--border)] hover:bg-[var(--card)]"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{definition.label}</span>
                      <span className="mt-1 block text-xs leading-5">{definition.description}</span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                  プロンプト項目が読み込まれていません。
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-[color:var(--border)] bg-[var(--card-soft)] p-4">
              {activeDefinition ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--text)]">{activeDefinition.label}</h3>
                      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{activeDefinition.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={onResetActivePromptToDefault}
                      className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}
                    >
                      初期値へ
                    </button>
                  </div>
                  <textarea
                    value={activePrompt}
                    onChange={(event) => onUpdatePromptDraft(activeDefinition.key, event.target.value)}
                    rows={activePromptRows}
                    className="mt-4 min-h-80 w-full resize-y rounded-3xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-4 font-mono text-sm leading-6 text-[var(--text)] outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-ring)]"
                    placeholder="AIに守らせたい判断方針を書きます"
                    spellCheck={false}
                  />
                  <p className="mt-3 text-xs leading-5 text-[var(--subtle)]">
                    保存先はGoogle Driveの `CGMP_Backup/prompts.json` です。AI解析時はこのテキストに、アプリ固定の出力契約を合成して使います。
                  </p>
                </>
              ) : (
                <div className="flex min-h-64 items-center justify-center text-sm text-[var(--muted)]">
                  左の項目を選択してください。
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[color:var(--border)] pt-4">
          <button type="button" onClick={onReload} disabled={loading || saving} className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}>
            Driveから再読込
          </button>
          <button type="button" onClick={onClose} className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!configDraft || loading || saving}
            className={`${primaryButtonClass} shrink-0 whitespace-nowrap`}
          >
            {saving ? "保存中..." : "Google Driveへ保存"}
          </button>
        </div>
      </section>
    </div>
  );
}
