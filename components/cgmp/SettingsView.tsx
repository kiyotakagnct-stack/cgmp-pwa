"use client";

import { useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";

import {
  Badge,
  dangerButtonClass,
  LabeledInput,
  LabeledSelect,
  LabeledTextarea,
  LabeledToggle,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  SectionHeading,
  SettingsAccordion,
  softPanelClass,
} from "@/components/cgmp/ui";
import { SEMANTIC_CANDIDATE_THRESHOLD } from "@/lib/cgmp/embedding";
import { DEFAULT_SEMANTIC_ICON_THRESHOLD } from "@/lib/cgmp/semantic-icons";
import type { ScriptableImportResult } from "@/lib/cgmp/scriptable-import";
import type { CGMPBackupSummary, CGMPRecord, CGMPSettings, CGMPSemanticIconEntry } from "@/lib/cgmp/types";
import {
  normalizeSemanticThreshold,
  type ThemeMode,
} from "@/lib/cgmp/client-utils";
import { formatJstDateTime } from "@/lib/cgmp/utils";

type DeployInfo = {
  ok?: boolean;
  commitMessage?: string;
  commitSha?: string;
  commitRef?: string;
  repository?: string;
  environment?: string;
  deploymentUrl?: string;
  deploymentId?: string;
  region?: string;
  generatedAt?: string;
};

type DriveBackupRecordPreview = {
  id: string;
  title?: string;
  summary?: string;
  action?: string;
  domain?: string;
  para?: string;
  updated_at?: string;
  backed_up_at?: string;
  checksum?: string;
  file_id?: string;
  pathname?: string;
  uploaded_at?: string;
  record?: Partial<CGMPRecord>;
  error?: boolean | string;
};

type DeletedRecordsSummary = {
  count: number;
  latestDeletedAt: string;
};

type EmbeddingProgressState = {
  running: boolean;
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  currentTitle: string;
  force: boolean;
  errors: string[];
};

type EmbeddingIndexStats = {
  count: number;
  dimensions: number;
  latestEmbeddedAt: string;
  model: string;
};

type SemanticIconProgressState = {
  running: boolean;
  mode: "dictionary" | "records";
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  currentTitle: string;
  errors: string[];
};

type SemanticIconIndexStats = {
  dictionaryCount: number;
  indexCount: number;
  latestEmbeddedAt: string;
  model: string;
};

type SettingsViewProps = {
  settingsDraft: CGMPSettings | null;
  setSettingsDraft: Dispatch<SetStateAction<CGMPSettings | null>>;
  settingsSaving: boolean;
  themeMode: ThemeMode;
  embeddingIndexStats: EmbeddingIndexStats | null;
  embeddingProgress: EmbeddingProgressState | null;
  embeddingCancelRef: MutableRefObject<boolean>;
  semanticIconDictionary: CGMPSemanticIconEntry[];
  semanticIconIndexStats: SemanticIconIndexStats | null;
  semanticIconProgress: SemanticIconProgressState | null;
  backupSummary: CGMPBackupSummary | null;
  deletedRecordsSummary: DeletedRecordsSummary | null;
  backupProcessing: boolean;
  driveBackupLoading: boolean;
  driveImporting: boolean;
  externalSyncing: boolean;
  webhookTestText: string;
  setWebhookTestText: Dispatch<SetStateAction<string>>;
  webhookTestToken: string;
  setWebhookTestToken: Dispatch<SetStateAction<string>>;
  webhookTestRunning: boolean;
  webhookTestReport: unknown;
  setIsWebhookTestModalOpen: Dispatch<SetStateAction<boolean>>;
  driveBackupRecords: DriveBackupRecordPreview[] | null;
  driveBackupCheckedAt: string;
  scriptableImportInputRef: RefObject<HTMLInputElement | null>;
  scriptableImporting: boolean;
  scriptableImportResult: ScriptableImportResult | null;
  deployInfoLoading: boolean;
  deployInfo: DeployInfo | null;
  handleSaveSettings: () => void;
  reloadSettings: () => void | Promise<void>;
  changeThemeMode: (mode: ThemeMode) => void;
  openPromptEditor: () => void;
  rebuildEmbeddingIndex: (force: boolean) => void | Promise<void>;
  reloadEmbeddingIndexStats: () => void | Promise<void>;
  rebuildSemanticIconDictionaryIndex: (force: boolean) => void | Promise<void>;
  reassignSemanticIcons: (force: boolean) => void | Promise<void>;
  resetSemanticIconsToDefault: () => void | Promise<void>;
  addSemanticIconEntry: (entry: CGMPSemanticIconEntry) => void | Promise<void>;
  runBackupQueue: (showNotice?: boolean) => void | Promise<void>;
  rebackupAllRecords: () => void | Promise<void>;
  loadDriveBackupList: () => void | Promise<void>;
  importMissingFromDrive: (showNotice?: boolean) => void | Promise<void>;
  syncExternalStatuses: (showNotice?: boolean) => void | Promise<void>;
  runShortcutWebhookTest: () => void | Promise<void>;
  handleScriptableImportFile: (file: File | undefined) => void | Promise<void>;
  handleHardReloadApp: () => void;
  handleClearAll: () => void | Promise<void>;
};

export function SettingsView({
  settingsDraft,
  setSettingsDraft,
  settingsSaving,
  themeMode,
  embeddingIndexStats,
  embeddingProgress,
  embeddingCancelRef,
  semanticIconDictionary,
  semanticIconIndexStats,
  semanticIconProgress,
  backupSummary,
  deletedRecordsSummary,
  backupProcessing,
  driveBackupLoading,
  driveImporting,
  externalSyncing,
  webhookTestText,
  setWebhookTestText,
  webhookTestToken,
  setWebhookTestToken,
  webhookTestRunning,
  webhookTestReport,
  setIsWebhookTestModalOpen,
  driveBackupRecords,
  driveBackupCheckedAt,
  scriptableImportInputRef,
  scriptableImporting,
  scriptableImportResult,
  deployInfoLoading,
  deployInfo,
  handleSaveSettings,
  reloadSettings,
  changeThemeMode,
  openPromptEditor,
  rebuildEmbeddingIndex,
  reloadEmbeddingIndexStats,
  rebuildSemanticIconDictionaryIndex,
  reassignSemanticIcons,
  resetSemanticIconsToDefault,
  addSemanticIconEntry,
  runBackupQueue,
  rebackupAllRecords,
  loadDriveBackupList,
  importMissingFromDrive,
  syncExternalStatuses,
  runShortcutWebhookTest,
  handleScriptableImportFile,
  handleHardReloadApp,
  handleClearAll,
}: SettingsViewProps) {
  const [newIconEmoji, setNewIconEmoji] = useState("");
  const [newIconLabel, setNewIconLabel] = useState("");
  const [newIconDescription, setNewIconDescription] = useState("");
  const [newIconKeywords, setNewIconKeywords] = useState("");
  const [newIconExamples, setNewIconExamples] = useState("");

  async function handleAddSemanticIcon() {
    const emoji = newIconEmoji.trim();
    const label = newIconLabel.trim();
    if (!emoji || !label) return;
    const key = `custom_${label
      .toLowerCase()
      .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32)}_${Date.now().toString(36)}`;
    await addSemanticIconEntry({
      key,
      emoji,
      label,
      description: newIconDescription.trim() || label,
      keywords: newIconKeywords
        .split(/[\n,、]+/)
        .map((item) => item.trim())
        .filter(Boolean),
      examples: newIconExamples
        .split(/[\n,、]+/)
        .map((item) => item.trim())
        .filter(Boolean),
      enabled: true,
      updated_at: new Date().toISOString(),
    });
    setNewIconEmoji("");
    setNewIconLabel("");
    setNewIconDescription("");
    setNewIconKeywords("");
    setNewIconExamples("");
  }

  return (
          <div className="grid gap-5">
            <section className={panelClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeading eyebrow="Settings" title="設定" description="必要な項目だけ開いて調整します。" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleSaveSettings} disabled={settingsSaving} className={primaryButtonClass}>
                    {settingsSaving ? "保存中..." : "設定を保存"}
                  </button>
                  <button type="button" onClick={() => reloadSettings()} className={secondaryButtonClass}>
                    再読み込み
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <SettingsAccordion title="基本設定" summary="AIモデル、タイムゾーン、表示テーマ。" defaultOpen>
                  <div className="grid gap-4 md:grid-cols-2">
                    <LabeledInput
                      label="OpenAI model"
                      value={settingsDraft?.openai_model || ""}
                      onChange={(value) => setSettingsDraft((prev) => (prev ? { ...prev, openai_model: value } : prev))}
                      placeholder="gpt-4.1-nano"
                    />
                    <LabeledInput
                      label="Timezone"
                      value={settingsDraft?.timezone || "Asia/Tokyo"}
                      onChange={(value) => setSettingsDraft((prev) => (prev ? { ...prev, timezone: value } : prev))}
                      placeholder="Asia/Tokyo"
                    />
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-medium text-[var(--text)]">Theme</div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[
                        { value: "system", label: "System" },
                        { value: "light", label: "Light" },
                        { value: "dark", label: "Dark" },
                      ].map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => changeThemeMode(item.value as ThemeMode)}
                          className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                            themeMode === item.value
                              ? "border-[color:var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                              : "border-[color:var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)]"
                          }`}
                          aria-pressed={themeMode === item.value}
                        >
                          <span className="mr-1">{themeMode === item.value ? "●" : "○"}</span>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </SettingsAccordion>

                <SettingsAccordion
                  title="AI と検索"
                  summary="プロンプト編集、意味検索、embedding index。"
                  badge={<Badge tone="cyan">{embeddingIndexStats?.count ?? 0} embeddings</Badge>}
                >
                  <div className={softPanelClass}>
                    <div className="text-sm font-medium text-[var(--text)]">AIプロンプト</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      Title、Summary、Action分類、写真解析などの判断方針を編集します。出力形式の固定ルールは非表示です。
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={openPromptEditor} className={secondaryButtonClass}>
                        AIプロンプトを編集
                      </button>
                    </div>
                  </div>

                  <div className={`${softPanelClass} mt-3`}>
                    <div className="text-sm font-medium text-[var(--text)]">意味検索インデックス</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">index</div>
                        <div className="mt-1 font-semibold text-[var(--text)]">{embeddingIndexStats?.count ?? 0}件</div>
                      </div>
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">model</div>
                        <div className="mt-1 truncate font-semibold text-[var(--text)]">
                          {embeddingIndexStats?.model || "text-embedding-3-small"}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">dimensions</div>
                        <div className="mt-1 font-semibold text-[var(--text)]">{embeddingIndexStats?.dimensions || "-"}</div>
                      </div>
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">latest</div>
                        <div className="mt-1 truncate font-semibold text-[var(--text)]">
                          {embeddingIndexStats?.latestEmbeddedAt ? formatJstDateTime(embeddingIndexStats.latestEmbeddedAt) : "未作成"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <LabeledInput
                        label="意味検索の閾値"
                        type="number"
                        value={String(settingsDraft?.semantic_search_threshold ?? SEMANTIC_CANDIDATE_THRESHOLD)}
                        onChange={(value) => {
                          const next = normalizeSemanticThreshold(value);
                          setSettingsDraft((prev) => (prev ? { ...prev, semantic_search_threshold: next } : prev));
                        }}
                        placeholder="0.45"
                      />
                      <LabeledSelect
                        label="意味検索の表示方式"
                        value={settingsDraft?.semantic_search_result_mode || "threshold"}
                        onChange={(value) =>
                          setSettingsDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  semantic_search_result_mode: value === "top10" ? "top10" : "threshold",
                                }
                              : prev
                          )
                        }
                        options={[
                          { value: "threshold", label: "閾値内を表示" },
                          { value: "top10", label: "近い順 Top10" },
                        ]}
                      />
                    </div>
                    <div className="mt-3">
                      <LabeledToggle
                        label="保存後に関連メモを提案する"
                        value={settingsDraft?.post_save_related_suggestions_enabled ?? true}
                        onChange={(value) =>
                          setSettingsDraft((prev) =>
                            prev ? { ...prev, post_save_related_suggestions_enabled: value } : prev
                          )
                        }
                      />
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                        OFFにすると、保存後の「こんなの関連しませんか？」モーダルだけを止めます。意味検索とembedding作成は維持します。
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void rebuildEmbeddingIndex(false)}
                        disabled={embeddingProgress?.running}
                        className={primaryButtonClass}
                      >
                        意味検索インデックスを作成
                      </button>
                      <button
                        type="button"
                        onClick={() => void rebuildEmbeddingIndex(true)}
                        disabled={embeddingProgress?.running}
                        className={secondaryButtonClass}
                      >
                        全件再作成
                      </button>
                      <button
                        type="button"
                        onClick={() => void reloadEmbeddingIndexStats()}
                        disabled={embeddingProgress?.running}
                        className={secondaryButtonClass}
                      >
                        状態を確認
                      </button>
                      {embeddingProgress?.running ? (
                        <button type="button" onClick={() => (embeddingCancelRef.current = true)} className={dangerButtonClass}>
                          中断
                        </button>
                      ) : null}
                    </div>
                    {embeddingProgress ? (
                      <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3 text-xs text-[var(--muted)]">
                        <div className="font-semibold text-[var(--text)]">
                          {embeddingProgress.running ? `処理中... ${embeddingProgress.completed} / ${embeddingProgress.total}` : "処理結果"}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <span>対象 {embeddingProgress.total}件</span>
                          <span>完了 {embeddingProgress.completed}件</span>
                          <span>スキップ {embeddingProgress.skipped}件</span>
                          <span>失敗 {embeddingProgress.failed}件</span>
                        </div>
                        {embeddingProgress.currentTitle ? (
                          <div className="mt-2 rounded-xl bg-[var(--card-soft)] px-3 py-2">{embeddingProgress.currentTitle}</div>
                        ) : null}
                        {embeddingProgress.errors.length > 0 ? (
                          <details className="mt-3">
                            <summary className="cursor-pointer font-semibold text-[var(--danger)]">
                              エラー {embeddingProgress.errors.length}件
                            </summary>
                            <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-[var(--danger)]">
                              {embeddingProgress.errors.map((error, index) => (
                                <li key={`${error}:${index}`}>{error}</li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className={`${softPanelClass} mt-3`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-[var(--text)]">Semantic Icon辞書</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                          メモの意味に近いemojiを自動選択します。閾値未満ならAction defaultへ戻します。
                        </p>
                      </div>
                      <Badge tone="cyan">
                        {semanticIconIndexStats?.indexCount ?? 0}/{semanticIconIndexStats?.dictionaryCount ?? semanticIconDictionary.length} icons
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <LabeledInput
                        label="Icon推定の閾値"
                        type="number"
                        value={String(settingsDraft?.semantic_icon_threshold ?? DEFAULT_SEMANTIC_ICON_THRESHOLD)}
                        onChange={(value) => {
                          const next = normalizeSemanticThreshold(value);
                          setSettingsDraft((prev) => (prev ? { ...prev, semantic_icon_threshold: next } : prev));
                        }}
                        placeholder="0.42"
                      />
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)]">
                        <div className="text-[var(--subtle)]">latest icon embedding</div>
                        <div className="mt-1 truncate font-semibold text-[var(--text)]">
                          {semanticIconIndexStats?.latestEmbeddedAt
                            ? formatJstDateTime(semanticIconIndexStats.latestEmbeddedAt)
                            : "未作成"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void rebuildSemanticIconDictionaryIndex(false)}
                        disabled={semanticIconProgress?.running}
                        className={primaryButtonClass}
                      >
                        Icon辞書embedding作成
                      </button>
                      <button
                        type="button"
                        onClick={() => void rebuildSemanticIconDictionaryIndex(true)}
                        disabled={semanticIconProgress?.running}
                        className={secondaryButtonClass}
                      >
                        辞書embedding再作成
                      </button>
                      <button
                        type="button"
                        onClick={() => void reassignSemanticIcons(true)}
                        disabled={semanticIconProgress?.running}
                        className={secondaryButtonClass}
                      >
                        全メモのIcon再推定
                      </button>
                      <button
                        type="button"
                        onClick={() => void resetSemanticIconsToDefault()}
                        disabled={semanticIconProgress?.running}
                        className={secondaryButtonClass}
                      >
                        辞書を初期値へ
                      </button>
                    </div>
                    {semanticIconProgress ? (
                      <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3 text-xs text-[var(--muted)]">
                        <div className="font-semibold text-[var(--text)]">
                          {semanticIconProgress.running
                            ? `処理中... ${semanticIconProgress.completed} / ${semanticIconProgress.total}`
                            : "処理結果"}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <span>対象 {semanticIconProgress.total}件</span>
                          <span>完了 {semanticIconProgress.completed}件</span>
                          <span>スキップ {semanticIconProgress.skipped}件</span>
                          <span>失敗 {semanticIconProgress.failed}件</span>
                        </div>
                        {semanticIconProgress.currentTitle ? (
                          <div className="mt-2 rounded-xl bg-[var(--card-soft)] px-3 py-2">
                            {semanticIconProgress.currentTitle}
                          </div>
                        ) : null}
                        {semanticIconProgress.errors.length > 0 ? (
                          <details className="mt-3">
                            <summary className="cursor-pointer font-semibold text-[var(--danger)]">
                              エラー {semanticIconProgress.errors.length}件
                            </summary>
                            <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-[var(--danger)]">
                              {semanticIconProgress.errors.map((error, index) => (
                                <li key={`${error}:${index}`}>{error}</li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    ) : null}

                    <details className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">辞書を追加</summary>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <LabeledInput label="Emoji" value={newIconEmoji} onChange={setNewIconEmoji} placeholder="🧯" />
                        <LabeledInput label="Label" value={newIconLabel} onChange={setNewIconLabel} placeholder="防災" />
                        <LabeledTextarea
                          label="Description"
                          value={newIconDescription}
                          onChange={setNewIconDescription}
                          placeholder="どんなメモに使うemojiか"
                        />
                        <LabeledTextarea
                          label="Keywords"
                          value={newIconKeywords}
                          onChange={setNewIconKeywords}
                          placeholder="台風、地震、防災"
                        />
                        <LabeledTextarea
                          label="Examples"
                          value={newIconExamples}
                          onChange={setNewIconExamples}
                          placeholder="台風対策の確認、避難用品の準備"
                        />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleAddSemanticIcon()}
                          disabled={!newIconEmoji.trim() || !newIconLabel.trim()}
                          className={primaryButtonClass}
                        >
                          辞書に追加
                        </button>
                      </div>
                    </details>

                    <details className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-[var(--text)]">
                        現在の辞書 {semanticIconDictionary.length}件
                      </summary>
                      <div className="mt-3 grid max-h-56 gap-2 overflow-auto text-xs text-[var(--muted)] sm:grid-cols-2">
                        {semanticIconDictionary.map((entry) => (
                          <div key={entry.key} className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                            <div className="font-semibold text-[var(--text)]">
                              <span className="mr-2">{entry.emoji}</span>
                              {entry.label}
                            </div>
                            <div className="mt-1 line-clamp-2">{entry.description}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                </SettingsAccordion>

                <SettingsAccordion
                  title="同期と連携"
                  summary="Google Drive、Google Tasks / Calendar、Drive上の実在確認。"
                  badge={<Badge tone={backupSummary && backupSummary.failed > 0 ? "rose" : "emerald"}>Drive</Badge>}
                >
                  <div className={softPanelClass}>
                    <div className="text-sm font-medium text-[var(--text)]">Google Drive 同期</div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                      <div>
                        <dt className="text-[var(--subtle)]">未バックアップ</dt>
                        <dd className="mt-1 text-lg font-semibold text-[var(--orange)]">
                          {backupSummary ? backupSummary.localOnly + backupSummary.pending : "-"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--subtle)]">バックアップ中</dt>
                        <dd className="mt-1 text-lg font-semibold text-[var(--accent)]">{backupSummary?.backingUp ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--subtle)]">失敗</dt>
                        <dd className="mt-1 text-lg font-semibold text-[var(--danger)]">{backupSummary?.failed ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--subtle)]">最終バックアップ</dt>
                        <dd className="mt-1 text-sm text-[var(--text)]">
                          {backupSummary?.lastBackupAt ? formatJstDateTime(backupSummary.lastBackupAt) : "未実行"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--subtle)]">削除済み</dt>
                        <dd className="mt-1 text-lg font-semibold text-[var(--text)]">{deletedRecordsSummary?.count ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--subtle)]">最終削除</dt>
                        <dd className="mt-1 text-sm text-[var(--text)]">
                          {deletedRecordsSummary?.latestDeletedAt ? formatJstDateTime(deletedRecordsSummary.latestDeletedAt) : "なし"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3">
                      <div className="text-sm font-semibold text-[var(--text)]">Google状態同期の対象範囲</div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        バックグラウンド同期でGoogle側を確認するrecordをDateベースで絞ります。日付なしの未完了Tasksは、Google側で後から日付が付く可能性があるため対象に残します。
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <LabeledInput
                          label="過去何日前から"
                          type="number"
                          value={String(settingsDraft?.external_sync_past_days ?? 7)}
                          onChange={(value) =>
                            setSettingsDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    external_sync_past_days: Math.max(0, Math.round(Number(value) || 0)),
                                  }
                                : prev
                            )
                          }
                          placeholder="7"
                        />
                        <LabeledInput
                          label="未来何日後まで"
                          type="number"
                          value={String(settingsDraft?.external_sync_future_days ?? 60)}
                          onChange={(value) =>
                            setSettingsDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    external_sync_future_days: Math.max(0, Math.round(Number(value) || 0)),
                                  }
                                : prev
                            )
                          }
                          placeholder="60"
                        />
                      </div>
                      <div className="mt-3 grid gap-2">
                        <LabeledToggle
                          label="完了済みTasksは同期しない"
                          value={settingsDraft?.external_sync_exclude_completed_tasks ?? true}
                          onChange={(value) =>
                            setSettingsDraft((prev) =>
                              prev ? { ...prev, external_sync_exclude_completed_tasks: value } : prev
                            )
                          }
                        />
                        <LabeledToggle
                          label="終了済みCalendar予定を同期対象から外す"
                          value={settingsDraft?.external_sync_exclude_ended_calendar ?? false}
                          onChange={(value) =>
                            setSettingsDraft((prev) =>
                              prev ? { ...prev, external_sync_exclude_ended_calendar: value } : prev
                            )
                          }
                        />
                      </div>
                      <div className="mt-3 text-xs text-[var(--subtle)]">
                        現在の既定: -{settingsDraft?.external_sync_past_days ?? 7}日 〜 +
                        {settingsDraft?.external_sync_future_days ?? 60}日
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => runBackupQueue(true)} className={primaryButtonClass}>
                        {backupProcessing ? "処理中..." : "今すぐバックアップ"}
                      </button>
                      <button type="button" onClick={rebackupAllRecords} disabled={backupProcessing} className={secondaryButtonClass}>
                        全件を再同期
                      </button>
                      <button type="button" onClick={loadDriveBackupList} disabled={driveBackupLoading} className={secondaryButtonClass}>
                        {driveBackupLoading ? "確認中..." : "Drive上の一覧を確認"}
                      </button>
                      <button type="button" onClick={() => importMissingFromDrive(true)} disabled={driveImporting} className={secondaryButtonClass}>
                        {driveImporting ? "取り込み中..." : "未取り込みを追加"}
                      </button>
                      <button type="button" onClick={() => syncExternalStatuses(true)} className={secondaryButtonClass}>
                        {externalSyncing ? "同期中..." : "Google状態を同期"}
                      </button>
                      <a href="/api/auth/google/start" className={secondaryButtonClass}>
                        Google連携を認可
                      </a>
                    </div>
                  </div>

                  <div className={`${softPanelClass} mt-3`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-[var(--text)]">Shortcut Webhook テスト</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                          iOS Shortcutと同じ `/api/shortcut-webhook` を呼び、AI解析・Google登録・Drive保存の処理時間を確認します。
                        </p>
                      </div>
                      <Badge tone="cyan">debug</Badge>
                    </div>
                    <div className="mt-4 grid gap-3">
                      <LabeledTextarea
                        label="Webhookに投げるテキスト"
                        value={webhookTestText}
                        onChange={setWebhookTestText}
                        rows={4}
                        placeholder="例: 明日17時に歯医者の予約"
                      />
                      <LabeledInput
                        label="Webhook token（設定している場合のみ）"
                        value={webhookTestToken}
                        onChange={setWebhookTestToken}
                        placeholder="SHORTCUT_WEBHOOK_TOKEN"
                        type="password"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={runShortcutWebhookTest}
                          disabled={webhookTestRunning}
                          className={primaryButtonClass}
                        >
                          {webhookTestRunning ? "Webhookテスト中..." : "進捗つきでWebhookテスト"}
                        </button>
                        {webhookTestReport ? (
                          <button type="button" onClick={() => setIsWebhookTestModalOpen(true)} className={secondaryButtonClass}>
                            前回レポートを見る
                          </button>
                        ) : null}
                      </div>
                      <p className="text-xs leading-5 text-[var(--subtle)]">
                        tokenは保存しません。テスト実行時だけAuthorizationヘッダーに入れます。
                      </p>
                    </div>
                  </div>

                  {driveBackupRecords ? (
                    <div className={`${softPanelClass} mt-3`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-[var(--text)]">Drive上に実在する正本</div>
                          <p className="mt-1 text-xs text-[var(--subtle)]">
                            {driveBackupCheckedAt ? `${formatJstDateTime(driveBackupCheckedAt)} に確認` : ""}
                          </p>
                        </div>
                        <Badge tone="emerald">{driveBackupRecords.length}件</Badge>
                      </div>
                      <div className="mt-4 max-h-80 space-y-2 overflow-auto pr-1">
                        {driveBackupRecords.length > 0 ? (
                          driveBackupRecords.map((backup) => (
                            <div
                              key={`${backup.id}:${backup.file_id || backup.pathname || ""}`}
                              className={`rounded-2xl border p-3 ${
                                backup.error
                                  ? "border-[color:var(--danger)] bg-[var(--danger-soft)]"
                                  : "border-[color:var(--border)] bg-[var(--card)]"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--subtle)]">
                                <Badge tone={backup.error ? "rose" : "emerald"}>{backup.error ? "読込失敗" : "実在確認済み"}</Badge>
                                <span>{backup.action || "note"}</span>
                                <span>{backup.domain || "other"}</span>
                                <span>{backup.para || "area"}</span>
                              </div>
                              <div className="mt-2 text-sm font-semibold text-[var(--text)]">{backup.title || "（無題）"}</div>
                              {backup.summary ? (
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{backup.summary}</p>
                              ) : null}
                              <div className="mt-3 grid gap-1 text-[11px] text-[var(--subtle)]">
                                <span>backup: {backup.backed_up_at ? formatJstDateTime(backup.backed_up_at) : "不明"}</span>
                                <span>record: {backup.id}</span>
                                <span>file: {backup.file_id}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-[var(--muted)]">Drive上の正本はまだありません。</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </SettingsAccordion>

                <SettingsAccordion title="データ移行と保守" summary="PWA再読み込み、Scriptable移行、全削除。">
                  <div className={softPanelClass}>
                    <div className="text-sm font-medium text-[var(--text)]">アプリ更新</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      ホーム画面PWAで古い画面が残る場合は、キャッシュ回避つきで再読み込みします。
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={handleHardReloadApp} className={secondaryButtonClass}>
                        アプリを再読み込み
                      </button>
                    </div>
                  </div>

                  <div className={`${softPanelClass} mt-3`}>
                    <div className="text-sm font-medium text-[var(--text)]">Scriptableデータ移行</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      移行用ZIPから records と preview画像をIndexedDBへ取り込みます。original画像とlogsは取り込みません。
                    </p>
                    <input
                      ref={scriptableImportInputRef}
                      type="file"
                      accept=".zip,application/zip,application/x-zip-compressed"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void handleScriptableImportFile(file);
                      }}
                    />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => scriptableImportInputRef.current?.click()}
                        disabled={scriptableImporting}
                        className={primaryButtonClass}
                      >
                        {scriptableImporting ? "インポート中..." : "Scriptable ZIPをインポート"}
                      </button>
                    </div>
                    {scriptableImportResult ? (
                      <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3 text-xs leading-6 text-[var(--muted)]">
                        <div className="grid gap-2 sm:grid-cols-4">
                          <span>追加: {scriptableImportResult.imported}</span>
                          <span>上書き: {scriptableImportResult.overwritten}</span>
                          <span>画像: {scriptableImportResult.imagesImported}</span>
                          <span>スキップ: {scriptableImportResult.skipped}</span>
                        </div>
                        {scriptableImportResult.errors.length > 0 ? (
                          <details className="mt-3">
                            <summary className="cursor-pointer font-semibold text-[var(--danger)]">
                              エラー/警告 {scriptableImportResult.errors.length}件
                            </summary>
                            <ul className="mt-2 max-h-36 space-y-1 overflow-auto text-[var(--danger)]">
                              {scriptableImportResult.errors.slice(0, 20).map((error, index) => (
                                <li key={`${error}:${index}`}>{error}</li>
                              ))}
                              {scriptableImportResult.errors.length > 20 ? (
                                <li>...ほか {scriptableImportResult.errors.length - 20}件</li>
                              ) : null}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button type="button" onClick={handleClearAll} className={dangerButtonClass}>
                      全削除
                    </button>
                  </div>
                </SettingsAccordion>

                <SettingsAccordion
                  title="更新情報"
                  summary={deployInfoLoading ? "取得中..." : deployInfo?.commitMessage || "最新デプロイ情報を確認します。"}
                  badge={deployInfo?.commitSha ? <Badge tone="slate">{deployInfo.commitSha}</Badge> : undefined}
                >
                  <div className="grid gap-3 text-sm text-[var(--muted)]">
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-3">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--subtle)]">Summary</div>
                      <div className="mt-2 font-semibold text-[var(--text)]">
                        {deployInfoLoading ? "取得中..." : deployInfo?.commitMessage || "GitHub commit message が取得できませんでした。"}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">branch</div>
                        <div className="mt-1 font-semibold text-[var(--text)]">{deployInfo?.commitRef || "-"}</div>
                      </div>
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">sha</div>
                        <div className="mt-1 font-semibold text-[var(--text)]">{deployInfo?.commitSha || "-"}</div>
                      </div>
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">repo</div>
                        <div className="mt-1 truncate font-semibold text-[var(--text)]">{deployInfo?.repository || "-"}</div>
                      </div>
                      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                        <div className="text-[var(--subtle)]">environment</div>
                        <div className="mt-1 font-semibold text-[var(--text)]">{deployInfo?.environment || "-"}</div>
                      </div>
                    </div>
                  </div>
                </SettingsAccordion>
              </div>
            </section>
          </div>
  );
}
