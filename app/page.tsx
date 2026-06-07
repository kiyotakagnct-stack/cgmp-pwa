"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { ImageAttachmentGrid } from "@/components/ImageAttachmentGrid";
import { ImageLightbox } from "@/components/ImageLightbox";
import { ImageUploader } from "@/components/ImageUploader";
import { ComposeView } from "@/components/cgmp/ComposeView";
import { HomeView } from "@/components/cgmp/HomeView";
import { PostSaveSuggestionsModal, type ExternalConfirmState } from "@/components/cgmp/PostSaveSuggestionsModal";
import { RecordEditor } from "@/components/cgmp/RecordEditor";
import { MiniRecordCard, RecordCard } from "@/components/cgmp/RecordCards";
import {
  BackupSyncProgressModal,
  ExternalSyncProgressModal,
  WebhookTestModal,
  type BackupSyncReportItem,
  type BackupSyncProgressState,
  type ExternalSyncReportItem,
  type ExternalSyncProgressState,
  type ShortcutWebhookTestReport,
} from "@/components/cgmp/ProgressModals";
import { PromptSettingsModal, type PromptEditorDefinition } from "@/components/cgmp/PromptSettingsModal";
import { SettingsView } from "@/components/cgmp/SettingsView";
import { TodayView } from "@/components/cgmp/TodayView";
import { WeeklyView } from "@/components/cgmp/WeeklyView";
import { deleteImageBlobs, getImageBlob, putImageBlob } from "@/lib/db/imageBlobStore";
import { analyzeImageWithVision, fallbackImageAnalysis } from "@/lib/image/analyzeImageWithVision";
import { createImageAttachmentFromFile } from "@/lib/image/createImageAttachment";
import {
  clearAllRecords,
  clearSemanticIconIndex,
  deleteRecord,
  loadAllRecords,
  loadDeletedRecords,
  loadEmbeddingIndex,
  loadSemanticIconDictionary,
  loadSemanticIconIndex,
  isRecordDeleted,
  loadSettings,
  putRecordWithoutBackup,
  saveSettings,
  saveSemanticIconDictionary,
  upsertRecord,
} from "@/lib/cgmp/storage";
import {
  ApiEmbeddingProvider,
  ensureRecordEmbedding,
  hashEmbeddingText,
  buildEmbeddingText,
  searchSimilarByText,
  searchSimilarByVector,
  SEMANTIC_CANDIDATE_THRESHOLD,
  type SimilarRecord,
} from "@/lib/cgmp/embedding";
import {
  DEFAULT_SEMANTIC_ICON_THRESHOLD,
  buildRecordIconText,
  ensureSemanticIconDictionaryIndex,
  inferSemanticIconForRecord,
  resetSemanticIconDictionary,
} from "@/lib/cgmp/semantic-icons";
import {
  backupDeleteTombstoneNow,
  enqueueAllRecordsForBackup,
  getBackupStatus,
  hydrateMissingAttachmentBlobs,
  importMissingRecordsFromDrive,
  processBackupQueue,
  processSingleRecordBackup,
} from "@/lib/cgmp/backup";
import { importScriptableCgmpZip, type ScriptableImportResult } from "@/lib/cgmp/scriptable-import";
import type {
  CGMPAction,
  CGMPAnalysis,
  CGMPAnalysisResponse,
  CGMPBackupSummary,
  CGMPDeletedRecord,
  CGMPDomain,
  CGMPGoogleTaskStatus,
  CGMPPara,
  CGMPRecord,
  CGMPSettings,
  CGMPSemanticIconEntry,
  CGMPSemanticSearchResultMode,
} from "@/lib/cgmp/types";
import type { CGMPPromptConfigFile, CGMPPromptKey } from "@/lib/cgmp/prompt-config";
import {
  formatJstDateTime,
  normalizeAction,
  normalizeDomain,
  normalizePara,
} from "@/lib/cgmp/utils";
import type { ImageAttachment, ImageVisionResult } from "@/types/image";
import {
  addDays,
  applyAnalysisToDraft,
  applyTheme,
  blankForm,
  dateKeyFromDate,
  formFromRecord,
  formToRecord,
  formatWeekDate,
  formatWeekRange,
  getActionInfo,
  getDateSortValue,
  getDomainInfo,
  getDraftRecordTitle,
  getEffectivePara,
  getExternalSyncWindow,
  getMondayOfWeek,
  getParaInfo,
  getRecordText,
  matchesMiniQuery,
  matchesQuery,
  normalizeSemanticThreshold,
  readStoredTheme,
  scrollToElementById,
  shouldSyncExternalRecord,
  startOfDay,
  THEME_STORAGE_KEY,
  type BadgeInfo,
  type RecordFormState,
  type ThemeMode,
} from "@/lib/cgmp/client-utils";
import {
  AiProcessingOverlay,
  Badge,
  BadgeInfoModal,
  dangerButtonClass,
  DomainBadge,
  fieldClass,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  softPanelClass,
} from "@/components/cgmp/ui";

type AppTab = "home" | "today" | "week" | "compose" | "settings";
type SortKey = "updated_at" | "created_at" | "datetime";
type SearchMode = "text" | "semantic";
type Notice = { kind: "info" | "error"; text: string } | null;
type SyncActivity = {
  id: number;
  status: "running" | "done" | "error";
  label: string;
  title?: string;
  detail?: string;
  startedAt: number;
};
type LightboxState = { imageUrl: string; title: string } | null;
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
type AiProcessingOverlayState = {
  id: number;
  kind: "text" | "image";
  label: string;
  startedAt: number;
  finishedAt?: number;
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
type GoogleTaskPayload = {
  ok?: boolean;
  taskListId?: string;
  taskId?: string;
  status?: CGMPGoogleTaskStatus;
  updatedAt?: string;
  error?: string;
};
type GoogleCalendarPayload = {
  ok?: boolean;
  calendarId?: string;
  eventId?: string;
  updatedAt?: string;
  error?: string;
};
type GoogleExternalSyncPayload = {
  ok?: boolean;
  results?: Array<{
    recordId: string;
    ok: boolean;
    title?: string;
    hasTask?: boolean;
    hasCalendar?: boolean;
    elapsedMs?: number;
    taskElapsedMs?: number;
    calendarElapsedMs?: number;
    google_task_status?: CGMPGoogleTaskStatus;
    google_task_due_date?: string;
    google_task_updated_at?: string;
    google_calendar_status?: string;
    google_calendar_updated_at?: string;
    calendar_title?: string;
    calendar_location?: string;
    calendar_date?: string;
    calendar_time?: string;
    calendar_all_day?: boolean;
    calendar_duration_minutes?: number;
    error?: string;
  }>;
  error?: string;
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
type DeletedRecordsSummary = {
  count: number;
  latestDeletedAt: string;
};
type ReanalysisExternalChoice = "rebuild" | "keep" | "cancel";
type ReanalysisExternalConfirmState = {
  recordId: string;
  title: string;
  externalLabel: string;
  resolve: (choice: ReanalysisExternalChoice) => void;
} | null;
export default function Page() {
  const [tab, setTab] = useState<AppTab>("home");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()));
  const [records, setRecords] = useState<CGMPRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("text");
  const [semanticSearching, setSemanticSearching] = useState(false);
  const [semanticResults, setSemanticResults] = useState<Array<{ recordId: string; score: number; level: "strong" | "candidate" }>>([]);
  const [semanticError, setSemanticError] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | CGMPAction>("all");
  const [domainFilter, setDomainFilter] = useState<"all" | CGMPDomain>("all");
  const [paraFilter, setParaFilter] = useState<"all" | CGMPPara>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<RecordFormState>(() => blankForm(""));
  const [composeAiStatus, setComposeAiStatus] = useState<CGMPRecord["ai_status"]>("none");
  const [composeAiError, setComposeAiError] = useState("");
  const [composeAiMeta, setComposeAiMeta] = useState<{ model: string; generated_at: string } | null>(null);
  const [composeLoading, setComposeLoading] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<CGMPSettings | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [deployInfo, setDeployInfo] = useState<DeployInfo | null>(null);
  const [deployInfoLoading, setDeployInfoLoading] = useState(false);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  const [promptDefinitions, setPromptDefinitions] = useState<PromptEditorDefinition[]>([]);
  const [promptConfigDraft, setPromptConfigDraft] = useState<CGMPPromptConfigFile | null>(null);
  const [promptConfigLoading, setPromptConfigLoading] = useState(false);
  const [promptConfigSaving, setPromptConfigSaving] = useState(false);
  const [promptConfigError, setPromptConfigError] = useState("");
  const [activePromptKey, setActivePromptKey] = useState<CGMPPromptKey>("action");
  const [detailDraft, setDetailDraft] = useState<RecordFormState | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailDeleting, setDetailDeleting] = useState(false);
  const [isEditPanelOpen, setIsEditPanelOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const composeRawInputRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmSectionRef = useRef<HTMLElement | null>(null);
  const [composeFocusTick, setComposeFocusTick] = useState(0);
  const [isMiniListOpen, setIsMiniListOpen] = useState(false);
  const [miniListQuery, setMiniListQuery] = useState("");
  const [pendingMiniJumpId, setPendingMiniJumpId] = useState<string | null>(null);
  const [backupSummary, setBackupSummary] = useState<CGMPBackupSummary | null>(null);
  const [backupProcessing, setBackupProcessing] = useState(false);
  const [backupSyncProgress, setBackupSyncProgress] = useState<BackupSyncProgressState | null>(null);
  const [backupProgressNow, setBackupProgressNow] = useState(0);
  const [driveBackupLoading, setDriveBackupLoading] = useState(false);
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveBackupRecords, setDriveBackupRecords] = useState<DriveBackupRecordPreview[] | null>(null);
  const [driveBackupCheckedAt, setDriveBackupCheckedAt] = useState("");
  const [deletedRecordsSummary, setDeletedRecordsSummary] = useState<DeletedRecordsSummary | null>(null);
  const [checkedRecordIds, setCheckedRecordIds] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const [syncActivity, setSyncActivity] = useState<SyncActivity | null>(null);
  const deployInfoRequestIdRef = useRef(0);
  const [photoProcessingCount, setPhotoProcessingCount] = useState(0);
  const [externalProcessingKey, setExternalProcessingKey] = useState("");
  const [externalConfirm, setExternalConfirm] = useState<ExternalConfirmState>(null);
  const [reanalysisExternalConfirm, setReanalysisExternalConfirm] = useState<ReanalysisExternalConfirmState>(null);
  const [externalSyncing, setExternalSyncing] = useState(false);
  const [externalSyncProgress, setExternalSyncProgress] = useState<ExternalSyncProgressState | null>(null);
  const [aiProcessingOverlay, setAiProcessingOverlay] = useState<AiProcessingOverlayState | null>(null);
  const [aiProcessingElapsedMs, setAiProcessingElapsedMs] = useState(0);
  const [webhookTestText, setWebhookTestText] = useState("");
  const [webhookTestToken, setWebhookTestToken] = useState("");
  const [webhookTestRunning, setWebhookTestRunning] = useState(false);
  const [webhookTestStartedAt, setWebhookTestStartedAt] = useState(0);
  const [webhookTestElapsedMs, setWebhookTestElapsedMs] = useState(0);
  const [webhookTestReport, setWebhookTestReport] = useState<ShortcutWebhookTestReport | null>(null);
  const [isWebhookTestModalOpen, setIsWebhookTestModalOpen] = useState(false);
  const [scriptableImporting, setScriptableImporting] = useState(false);
  const [scriptableImportResult, setScriptableImportResult] = useState<ScriptableImportResult | null>(null);
  const [embeddingProgress, setEmbeddingProgress] = useState<EmbeddingProgressState | null>(null);
  const [embeddingIndexStats, setEmbeddingIndexStats] = useState<EmbeddingIndexStats | null>(null);
  const [semanticIconDictionary, setSemanticIconDictionary] = useState<CGMPSemanticIconEntry[]>([]);
  const [semanticIconIndexStats, setSemanticIconIndexStats] = useState<SemanticIconIndexStats | null>(null);
  const [semanticIconProgress, setSemanticIconProgress] = useState<SemanticIconProgressState | null>(null);
  const [relatedCandidates, setRelatedCandidates] = useState<SimilarRecord[]>([]);
  const [badgeInfo, setBadgeInfo] = useState<BadgeInfo>(null);
  const initialDriveImportDoneRef = useRef(false);
  const initialExternalSyncDoneRef = useRef(false);
  const aiProcessingIdRef = useRef(0);
  const aiProcessingHideTimerRef = useRef<number | null>(null);
  const syncActivityIdRef = useRef(0);
  const syncActivityHideTimerRef = useRef<number | null>(null);
  const scriptableImportInputRef = useRef<HTMLInputElement | null>(null);
  const embeddingProviderRef = useRef(new ApiEmbeddingProvider());
  const embeddingCancelRef = useRef(false);

  function changeThemeMode(mode: ThemeMode) {
    setThemeMode(mode);
    applyTheme(mode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Theme preference is nice-to-have; the UI still updates for this session.
    }
  }

  function startSyncActivity(label: string, title?: string, detail?: string) {
    if (syncActivityHideTimerRef.current) {
      window.clearTimeout(syncActivityHideTimerRef.current);
      syncActivityHideTimerRef.current = null;
    }
    const id = syncActivityIdRef.current + 1;
    syncActivityIdRef.current = id;
    setSyncActivity({
      id,
      status: "running",
      label,
      title,
      detail,
      startedAt: performance.now(),
    });
    return id;
  }

  function updateSyncActivity(id: number, patch: Partial<Omit<SyncActivity, "id" | "startedAt">>) {
    setSyncActivity((current) => (current?.id === id ? { ...current, ...patch } : current));
  }

  function finishSyncActivity(id: number, status: "done" | "error" = "done", label?: string, detail?: string) {
    setSyncActivity((current) => {
      if (!current || current.id !== id) return current;
      return {
        ...current,
        status,
        label: label || current.label,
        detail: detail || current.detail,
      };
    });
    if (syncActivityHideTimerRef.current) window.clearTimeout(syncActivityHideTimerRef.current);
    syncActivityHideTimerRef.current = window.setTimeout(() => {
      setSyncActivity((current) => (current?.id === id ? null : current));
      syncActivityHideTimerRef.current = null;
    }, status === "error" ? 3200 : 1800);
  }

  function getBackupActivityLabel(stage?: string) {
    if (stage === "skip") return "Checking";
    if (stage === "delete") return "Deleting";
    return "Uploading";
  }

  async function reloadRecords(preferredId?: string) {
    const nextRecords = await loadAllRecords();
    setRecords(nextRecords);
    setSelectedId((current) => {
      if (preferredId && nextRecords.some((record) => record.id === preferredId)) {
        return preferredId;
      }
      if (current && nextRecords.some((record) => record.id === current)) {
        return current;
      }
      return null;
    });
  }

  async function reloadSettings() {
    const nextSettings = await loadSettings();
    setSettingsDraft(nextSettings);
  }

  async function reloadBackupSummary() {
    const nextSummary = await getBackupStatus();
    setBackupSummary(nextSummary);
  }

  async function reloadDeletedRecordsSummary() {
    const tombstones = await loadDeletedRecords();
    setDeletedRecordsSummary({
      count: tombstones.length,
      latestDeletedAt: tombstones[0]?.deleted_at || "",
    });
  }

  function beginAiProcessing(kind: "text" | "image", label: string) {
    if (aiProcessingHideTimerRef.current !== null) {
      window.clearTimeout(aiProcessingHideTimerRef.current);
      aiProcessingHideTimerRef.current = null;
    }
    const id = aiProcessingIdRef.current + 1;
    aiProcessingIdRef.current = id;
    setAiProcessingElapsedMs(0);
    setAiProcessingOverlay({
      id,
      kind,
      label,
      startedAt: performance.now(),
    });
    return id;
  }

  function finishAiProcessing(id: number) {
    const finishedAt = performance.now();
    setAiProcessingOverlay((current) => {
      if (!current || current.id !== id) return current;
      setAiProcessingElapsedMs(Math.round(finishedAt - current.startedAt));
      return { ...current, finishedAt };
    });
    aiProcessingHideTimerRef.current = window.setTimeout(() => {
      setAiProcessingOverlay((current) => (current?.id === id ? null : current));
      aiProcessingHideTimerRef.current = null;
    }, 300);
  }

  async function runBackupQueue(showNotice = false) {
    if (backupProcessing) {
      if (showNotice) {
        const now = performance.now();
        setBackupSyncProgress({
          phase: "processing",
          message: "バックアップ処理がすでに実行中です。完了まで少し待ってください。",
          startedAt: now,
          total: 0,
          succeeded: 0,
          failed: 0,
          processElapsedMs: 0,
          reloadElapsedMs: 0,
          reportItems: [],
        });
      }
      return;
    }
    const startedAt = performance.now();
    const activityId = startSyncActivity("Uploading", "Google Drive", "同期キューを確認中");
    if (showNotice) {
      setBackupSyncProgress({
        phase: "processing",
        message: "Google Drive同期を開始しています。",
        startedAt,
        total: 0,
        succeeded: 0,
        failed: 0,
        processElapsedMs: 0,
        reloadElapsedMs: 0,
        reportItems: [],
      });
    }
    setBackupProcessing(true);
    try {
      const processStartedAt = performance.now();
      const results = await processBackupQueue({
        onProgress: (progress) => {
          updateSyncActivity(activityId, {
            label: getBackupActivityLabel(progress.stage),
            title: progress.currentTitle || "Google Drive",
            detail: `${getBackupStageLabel(progress.stage)} ${progress.completed}/${progress.total}`,
          });
          setBackupSyncProgress((current) => {
            if (!current || current.phase !== "processing") return current;
            const newItems = backupResultsToReportItems(progress.results);
            const reportItems = [...current.reportItems, ...newItems];
            const failed = reportItems.filter((item) => !item.ok).length;
            const completed = Math.max(reportItems.length, progress.completed);
            return {
              ...current,
              message: progress.currentTitle
                ? `${getBackupStageLabel(progress.stage)}: ${progress.currentTitle}（${progress.completed}/${progress.total}）`
                : `Google Drive同期中（${progress.completed}/${progress.total}）`,
              total: Math.max(current.total, progress.total, completed),
              succeeded: reportItems.length - failed,
              failed,
              processElapsedMs: Math.round(performance.now() - processStartedAt),
              reportItems,
            };
          });
        },
      });
      const processElapsedMs = Math.round(performance.now() - processStartedAt);
      const reloadStartedAt = performance.now();
      await Promise.all([reloadRecords(), reloadBackupSummary()]);
      const reloadElapsedMs = Math.round(performance.now() - reloadStartedAt);
      const failed = results.filter((result) => !result.ok).length;
      const reportItems = backupResultsToReportItems(results);
      const skipped = reportItems.filter((item) => item.skipped).length;
      if (showNotice) {
        const finishedAt = performance.now();
        console.table(
          reportItems.map((item) => ({
            title: item.title,
            ok: item.ok,
            skipped: item.skipped,
            type: item.itemType,
            total_ms: item.elapsedMs,
            blob_ms: item.blobElapsedMs,
            upload_ms: item.uploadElapsedMs,
            preview_kb: Math.round(item.previewSizeBytes / 1024),
            error: item.error,
          }))
        );
        console.debug("[cgmp:drive-sync] report", {
          total: results.length,
          succeeded: results.length - failed,
          failed,
          processElapsedMs,
          reloadElapsedMs,
          totalElapsedMs: Math.round(finishedAt - startedAt),
          slowest: [...reportItems].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 8),
        });
        setBackupSyncProgress({
          phase: "done",
          message:
            results.length === 0
              ? "バックアップ待ちの記録はありません。"
              : failed > 0
                ? `バックアップ完了: 成功${results.length - failed}件 / 失敗${failed}件`
                : skipped > 0
                  ? `バックアップ完了: 成功${results.length - skipped}件 / スキップ${skipped}件`
                  : `バックアップ完了: 成功${results.length}件`,
          startedAt,
          finishedAt,
          total: results.length,
          succeeded: results.length - failed,
          failed,
          processElapsedMs,
          reloadElapsedMs,
          reportItems,
        });
      }
      if (showNotice) {
        setNotice({
          kind: failed > 0 ? "error" : "info",
          text:
            results.length === 0
              ? "バックアップ待ちの記録はありません。"
              : failed > 0
                ? `バックアップに失敗した記録があります（${failed}件）。`
                : `バックアップしました（${results.length}件）。`,
        });
      }
      finishSyncActivity(
        activityId,
        failed > 0 ? "error" : "done",
        failed > 0 ? "Upload failed" : "Upload complete",
        results.length === 0 ? "待機中の同期はありません" : `成功${results.length - failed} / 失敗${failed}`
      );
    } catch (error) {
      if (showNotice) {
        setBackupSyncProgress({
          phase: "error",
          message: error instanceof Error ? error.message : "バックアップに失敗しました",
          startedAt,
          finishedAt: performance.now(),
          total: 0,
          succeeded: 0,
          failed: 1,
          processElapsedMs: Math.round(performance.now() - startedAt),
          reloadElapsedMs: 0,
          reportItems: [],
        });
      }
      if (showNotice) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "バックアップに失敗しました",
        });
      }
      finishSyncActivity(
        activityId,
        "error",
        "Upload failed",
        error instanceof Error ? error.message : "バックアップに失敗しました"
      );
    } finally {
      setBackupProcessing(false);
    }
  }

  function backupResultsToReportItems(results: Awaited<ReturnType<typeof processBackupQueue>>): BackupSyncReportItem[] {
    return results.map((result) => ({
      recordId: result.recordId,
      title: result.title || result.recordId,
      ok: result.ok,
      itemType: result.itemType || "record",
      skipped: Boolean(result.skipped),
      attachmentId: result.attachmentId || "",
      elapsedMs: Math.round(result.elapsedMs || 0),
      blobElapsedMs: Math.round(result.blobElapsedMs || 0),
      uploadElapsedMs: Math.round(result.uploadElapsedMs || 0),
      previewSizeBytes: result.previewSizeBytes || 0,
      thumbnailSizeBytes: result.thumbnailSizeBytes || 0,
      error: result.error || "",
    }));
  }

  function getBackupStageLabel(stage?: string) {
    switch (stage) {
      case "record_loaded":
        return "record確認中";
      case "attachment_preparing":
        return "写真メタデータ更新中";
      case "attachment_uploading":
        return "写真アップロード中";
      case "attachment_done":
        return "写真アップロード完了";
      case "attachment_failed":
        return "写真アップロード失敗";
      case "record_preparing":
        return "record保存準備中";
      case "record_uploading":
        return "record JSON送信中";
      case "record_done":
        return "record保存完了";
      case "record_failed":
        return "record保存失敗";
      case "record_group_done":
        return "record一式完了";
      case "record_skipped_pending_ai":
        return "下書きのためスキップ";
      case "record_not_found":
        return "recordが見つかりません";
      default:
        return "同期中";
    }
  }

  async function runSingleRecordBackup(recordId: string) {
    if (backupProcessing) {
      const now = performance.now();
      setBackupSyncProgress({
        phase: "processing",
        message: "別の同期が実行中です。完了後にもう一度試してください。",
        startedAt: now,
        total: 0,
        succeeded: 0,
        failed: 0,
        processElapsedMs: 0,
        reloadElapsedMs: 0,
        reportItems: [],
      });
      return;
    }

    const record = records.find((candidate) => candidate.id === recordId);
    const title = record?.title || record?.summary || recordId;
    const startedAt = performance.now();
    const activityId = startSyncActivity("Uploading", title, "1件同期を開始");
    setBackupSyncProgress({
      phase: "processing",
      message: `「${title}」だけをGoogle Driveへ同期しています。`,
      startedAt,
      total: 1,
      succeeded: 0,
      failed: 0,
      processElapsedMs: 0,
      reloadElapsedMs: 0,
      reportItems: [],
    });
    setBackupProcessing(true);
    try {
      const processStartedAt = performance.now();
      const results = await processSingleRecordBackup(recordId, { force: true });
      updateSyncActivity(activityId, { label: "Uploading", title, detail: "Google Driveへ保存中" });
      const processElapsedMs = Math.round(performance.now() - processStartedAt);
      const reloadStartedAt = performance.now();
      await Promise.all([reloadRecords(), reloadBackupSummary()]);
      const reloadElapsedMs = Math.round(performance.now() - reloadStartedAt);
      const failed = results.filter((result) => !result.ok).length;
      const reportItems = backupResultsToReportItems(results);
      const finishedAt = performance.now();
      console.table(
        reportItems.map((item) => ({
          title: item.title,
          ok: item.ok,
          skipped: item.skipped,
          type: item.itemType,
          attachment: item.attachmentId,
          total_ms: item.elapsedMs,
          blob_ms: item.blobElapsedMs,
          upload_ms: item.uploadElapsedMs,
          preview_kb: Math.round(item.previewSizeBytes / 1024),
          error: item.error,
        }))
      );
      console.debug("[cgmp:drive-sync:single] report", {
        recordId,
        title,
        total: results.length,
        succeeded: results.length - failed,
        failed,
        processElapsedMs,
        reloadElapsedMs,
        totalElapsedMs: Math.round(finishedAt - startedAt),
        items: reportItems,
      });
      setBackupSyncProgress({
        phase: "done",
        message:
          failed > 0
            ? `1件同期で失敗があります（成功${results.length - failed} / 失敗${failed}）。`
            : `1件同期が完了しました（処理${results.length}件）。`,
        startedAt,
        finishedAt,
        total: results.length,
        succeeded: results.length - failed,
        failed,
        processElapsedMs,
        reloadElapsedMs,
        reportItems,
      });
      setNotice({
        kind: failed > 0 ? "error" : "info",
        text: failed > 0 ? "1件同期で失敗があります。詳細モーダルを確認してください。" : "1件同期が完了しました。",
      });
      finishSyncActivity(
        activityId,
        failed > 0 ? "error" : "done",
        failed > 0 ? "Upload failed" : "Upload complete",
        failed > 0 ? `失敗${failed}` : title
      );
    } catch (error) {
      setBackupSyncProgress({
        phase: "error",
        message: error instanceof Error ? error.message : "1件同期に失敗しました",
        startedAt,
        finishedAt: performance.now(),
        total: 1,
        succeeded: 0,
        failed: 1,
        processElapsedMs: Math.round(performance.now() - startedAt),
        reloadElapsedMs: 0,
        reportItems: [
          {
            recordId,
            title,
            ok: false,
            itemType: "record",
            skipped: false,
            attachmentId: "",
            elapsedMs: Math.round(performance.now() - startedAt),
            blobElapsedMs: 0,
            uploadElapsedMs: 0,
            previewSizeBytes: 0,
            thumbnailSizeBytes: 0,
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      });
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "1件同期に失敗しました" });
      finishSyncActivity(activityId, "error", "Upload failed", error instanceof Error ? error.message : "1件同期に失敗しました");
    } finally {
      setBackupProcessing(false);
    }
  }

  function getRegisteredExternalLabel(record: CGMPRecord) {
    const labels: string[] = [];
    if (record.google_task_id && record.google_task_list_id) labels.push("Google Tasks");
    if (record.google_calendar_event_id && record.google_calendar_id) labels.push("Google Calendar");
    return labels.join(" / ");
  }

  function clearExternalRegistrationFields(record: CGMPRecord, externalError = ""): CGMPRecord {
    return {
      ...record,
      external_action_status: externalError ? "failed" : "none",
      external_target: "",
      external_registered_at: "",
      external_error: externalError,
      google_task_id: "",
      google_task_list_id: "",
      google_task_status: "",
      google_task_updated_at: "",
      google_calendar_event_id: "",
      google_calendar_id: "",
      google_calendar_updated_at: "",
    };
  }

  function askReanalysisExternalChoice(record: CGMPRecord): Promise<ReanalysisExternalChoice> {
    const externalLabel = getRegisteredExternalLabel(record);
    if (!externalLabel) return Promise.resolve("keep");

    return new Promise((resolve) => {
      setReanalysisExternalConfirm({
        recordId: record.id,
        title: record.title || record.summary || "（無題）",
        externalLabel,
        resolve,
      });
    });
  }

  function resolveReanalysisExternalChoice(choice: ReanalysisExternalChoice) {
    const resolver = reanalysisExternalConfirm?.resolve;
    setReanalysisExternalConfirm(null);
    resolver?.(choice);
  }

  async function saveExternalRecordUpdate(nextRecord: CGMPRecord, options: { backup?: boolean } = {}) {
    const saved = await upsertRecord(nextRecord);
    setRecords((current) => current.map((record) => (record.id === saved.id ? saved : record)));
    if (selectedId === saved.id) {
      setDetailDraft(formFromRecord(saved));
    }
    await Promise.all([reloadRecords(), reloadBackupSummary()]);
    if (options.backup !== false) {
      void runBackupQueue(false);
    }
    return saved;
  }

  async function updateRegisteredExternalItems(record: CGMPRecord) {
    let nextRecord = record;
    const errors: string[] = [];

    if (record.google_task_id && record.google_task_list_id) {
      const activityId = startSyncActivity("Sync Reminder", record.title || record.summary || "Google Tasks", "Google Tasks更新中");
      try {
        const response = await fetch("/api/external/google/task", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record }),
        });
        const payload = (await response.json().catch(() => ({}))) as GoogleTaskPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "GOOGLE_TASK_UPDATE_FAILED");
        }
        nextRecord = {
          ...nextRecord,
          external_action_status: "registered",
          external_error: "",
          google_task_status: payload.status || nextRecord.google_task_status || "needsAction",
          google_task_updated_at: payload.updatedAt || new Date().toISOString(),
        };
        finishSyncActivity(activityId, "done", "Reminder synced", record.title || "Google Tasks");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Google Tasks更新に失敗しました");
        finishSyncActivity(activityId, "error", "Reminder sync failed", error instanceof Error ? error.message : "Google Tasks更新に失敗しました");
      }
    }

    if (record.google_calendar_event_id && record.google_calendar_id) {
      const activityId = startSyncActivity("Sync Calendar", record.title || record.summary || "Google Calendar", "Google Calendar更新中");
      try {
        const response = await fetch("/api/external/google/calendar", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record }),
        });
        const payload = (await response.json().catch(() => ({}))) as GoogleCalendarPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "GOOGLE_CALENDAR_UPDATE_FAILED");
        }
        nextRecord = {
          ...nextRecord,
          external_action_status: "registered",
          external_error: "",
          google_calendar_updated_at: payload.updatedAt || new Date().toISOString(),
        };
        finishSyncActivity(activityId, "done", "Calendar synced", record.title || "Google Calendar");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Google Calendar更新に失敗しました");
        finishSyncActivity(activityId, "error", "Calendar sync failed", error instanceof Error ? error.message : "Google Calendar更新に失敗しました");
      }
    }

    if (errors.length > 0) {
      nextRecord = {
        ...nextRecord,
        external_action_status: "failed",
        external_error: errors.join(" / "),
      };
    }

    if (nextRecord !== record || errors.length > 0) {
      return upsertRecord({ ...nextRecord, updated_at: new Date().toISOString() });
    }
    return record;
  }

  async function deleteRegisteredExternalItems(record: CGMPRecord) {
    const errors: string[] = [];
    const ignoreNotFound = (error: unknown) => /not\s*found|404/i.test(error instanceof Error ? error.message : String(error));

    if (record.google_task_id && record.google_task_list_id) {
      try {
        const response = await fetch("/api/external/google/task", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskListId: record.google_task_list_id,
            taskId: record.google_task_id,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as GoogleTaskPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "GOOGLE_TASK_DELETE_FAILED");
        }
      } catch (error) {
        if (!ignoreNotFound(error)) {
          errors.push(error instanceof Error ? error.message : "Google Tasks削除に失敗しました");
        }
      }
    }

    if (record.google_calendar_event_id && record.google_calendar_id) {
      try {
        const response = await fetch("/api/external/google/calendar", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId: record.google_calendar_id,
            eventId: record.google_calendar_event_id,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as GoogleCalendarPayload;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "GOOGLE_CALENDAR_DELETE_FAILED");
        }
      } catch (error) {
        if (!ignoreNotFound(error)) {
          errors.push(error instanceof Error ? error.message : "Google Calendar削除に失敗しました");
        }
      }
    }

    return errors;
  }

  async function createDeletionTombstone(record: CGMPRecord, externalErrors: string[]): Promise<CGMPDeletedRecord | null> {
    const tombstone = await deleteRecord(record.id, {
      title: record.title || "",
      drive_file_id: record.drive_file_id || "",
      attachment_drive_file_ids: (record.attachments || []).flatMap((attachment) =>
        [attachment.previewDriveFileId, attachment.thumbnailDriveFileId].filter(Boolean) as string[]
      ),
      google_task_id: record.google_task_id || "",
      google_task_list_id: record.google_task_list_id || "",
      google_calendar_event_id: record.google_calendar_event_id || "",
      google_calendar_id: record.google_calendar_id || "",
      external_delete_status: externalErrors.length > 0 ? "failed" : "done",
      external_delete_error: externalErrors.join(" / "),
    });

    if (tombstone) {
      const result = await backupDeleteTombstoneNow(tombstone);
      if (!result.ok) {
        setNotice({
          kind: "error",
          text: `削除済み情報のDrive同期に失敗しました: ${result.error || "UNKNOWN_ERROR"}`,
        });
      }
    }
    return tombstone;
  }

  async function syncExternalStatuses(showNotice = false) {
    if (externalSyncing) {
      if (showNotice) {
        const now = performance.now();
        setExternalSyncProgress({
          phase: "done",
          total: 0,
          checked: 0,
          applied: 0,
          changed: 0,
          failed: 0,
          message: "バックグラウンド同期が実行中です。少し待ってからもう一度押してください。",
          currentTitle: "",
          startedAt: now,
          checkingElapsedMs: 0,
          applyingElapsedMs: 0,
          reloadElapsedMs: 0,
          reportItems: [],
        });
      }
      return;
    }
    const targets = records.filter((record) => shouldSyncExternalRecord(record, settingsDraft));
    if (targets.length === 0) {
      if (showNotice) {
        const now = performance.now();
        setExternalSyncProgress({
          phase: "done",
          total: 0,
          checked: 0,
          applied: 0,
          changed: 0,
          failed: 0,
          message: "Google連携済みの記録はありません。",
          currentTitle: "",
          startedAt: now,
          checkingElapsedMs: 0,
          applyingElapsedMs: 0,
          reloadElapsedMs: 0,
          reportItems: [],
          finishedAt: now,
        });
        setNotice({ kind: "info", text: "Google連携済みの記録はありません。" });
      }
      return;
    }

    setExternalSyncing(true);
    const startedAt = performance.now();
    const syncWindow = getExternalSyncWindow(settingsDraft);
    const activityId = startSyncActivity(
      "Checking Google updates",
      "Tasks / Calendar",
      `-${syncWindow.pastDays}日〜+${syncWindow.futureDays}日 / ${targets.length}件`
    );
    const setManualProgress = (patch: Partial<ExternalSyncProgressState>) => {
      if (!showNotice) return;
      setExternalSyncProgress((prev) => ({
        phase: "preparing",
        total: targets.length,
        checked: 0,
        applied: 0,
        changed: 0,
        failed: 0,
        message: "同期対象を確認しています。",
        currentTitle: "",
        startedAt,
        checkingElapsedMs: 0,
        applyingElapsedMs: 0,
        reloadElapsedMs: 0,
        reportItems: [],
        ...prev,
        ...patch,
      }));
    };
    const fetchSyncResults = async (syncTargets: CGMPRecord[]) => {
      const response = await fetch("/api/external/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: syncTargets }),
      });
      const payload = (await response.json().catch(() => ({}))) as GoogleExternalSyncPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "GOOGLE_EXTERNAL_SYNC_FAILED");
      }
      return payload.results || [];
    };

    setManualProgress({ phase: "preparing", message: `同期対象 ${targets.length} 件を準備しています。` });
    try {
      const results: NonNullable<GoogleExternalSyncPayload["results"]> = [];
      let checkedFailed = 0;
      const checkingStartedAt = performance.now();
      if (showNotice) {
        const batchSize = 5;
        for (let index = 0; index < targets.length; index += batchSize) {
          const batchTargets = targets.slice(index, index + batchSize);
          const batchEnd = Math.min(index + batchTargets.length, targets.length);
          const firstTarget = batchTargets[0];
          updateSyncActivity(activityId, {
            label: "Checking Google updates",
            title:
              batchTargets.length > 1
                ? `${firstTarget.title || firstTarget.summary || firstTarget.raw_input || firstTarget.id} ほか${batchTargets.length - 1}件`
                : firstTarget.title || firstTarget.summary || firstTarget.raw_input || firstTarget.id,
            detail: `${index}/${targets.length}`,
          });
          setManualProgress({
            phase: "checking",
            checked: index,
            message: `Google側と照合中 ${index}/${targets.length}`,
            currentTitle:
              batchTargets.length > 1
                ? `${firstTarget.title || firstTarget.summary || firstTarget.raw_input || firstTarget.id} ほか${batchTargets.length - 1}件`
                : firstTarget.title || firstTarget.summary || firstTarget.raw_input || firstTarget.id,
          });
          const batchResults = await fetchSyncResults(batchTargets);
          results.push(...batchResults);
          checkedFailed += batchResults.filter((result) => !result.ok).length;
          setManualProgress({
            phase: "checking",
            checked: batchEnd,
            failed: checkedFailed,
            checkingElapsedMs: Math.round(performance.now() - checkingStartedAt),
            message: `Google側と照合中 ${batchEnd}/${targets.length}`,
            currentTitle:
              batchTargets.length > 1
                ? `${firstTarget.title || firstTarget.summary || firstTarget.raw_input || firstTarget.id} ほか${batchTargets.length - 1}件`
                : firstTarget.title || firstTarget.summary || firstTarget.raw_input || firstTarget.id,
          });
        }
      } else {
        results.push(...(await fetchSyncResults(targets)));
      }
      const checkingElapsedMs = Math.round(performance.now() - checkingStartedAt);

      const resultById = new Map(results.map((result) => [result.recordId, result]));
      let changed = 0;
      let failed = results.filter((result) => !result.ok).length;
      const reportItems: ExternalSyncReportItem[] = [];
      const applyingStartedAt = performance.now();
      for (let index = 0; index < targets.length; index += 1) {
        const record = targets[index];
        const result = resultById.get(record.id);
        if (!result) continue;
        updateSyncActivity(activityId, {
          label: record.google_calendar_event_id ? "Checking Calendar update" : "Checking Reminder update",
          title: record.title || record.summary || record.raw_input || record.id,
          detail: `${index}/${targets.length}`,
        });
        setManualProgress({
          phase: "applying",
          applied: index,
          changed,
          failed,
          message: `CGMPへ反映中 ${index}/${targets.length}`,
          currentTitle: record.title || record.summary || record.raw_input || record.id,
        });
        if (await isRecordDeleted(record.id)) continue;
        const applyStartedAt = performance.now();
        const taskDueDate =
          record.google_task_id && typeof result.google_task_due_date === "string" ? result.google_task_due_date : record.date;
        const calendarDate = record.google_calendar_event_id && result.calendar_date ? result.calendar_date : "";
        const nextRecord: CGMPRecord = result.ok
          ? {
              ...record,
              external_action_status: "registered",
              external_error: "",
              google_task_status: result.google_task_status || record.google_task_status,
              google_task_updated_at: result.google_task_updated_at || record.google_task_updated_at,
              google_calendar_updated_at: result.google_calendar_updated_at || record.google_calendar_updated_at,
              title: result.calendar_title || record.title,
              location: result.calendar_location ?? record.location,
              date: calendarDate || taskDueDate,
              time: typeof result.calendar_time === "string" ? result.calendar_time : record.time,
              all_day: typeof result.calendar_all_day === "boolean" ? result.calendar_all_day : record.all_day,
              duration_minutes:
                typeof result.calendar_duration_minutes === "number" && result.calendar_duration_minutes > 0
                  ? result.calendar_duration_minutes
                  : record.duration_minutes,
            }
          : {
              ...record,
              external_action_status: "failed",
              external_error: result.error || "Google状態同期に失敗しました",
            };
        if (JSON.stringify(nextRecord) !== JSON.stringify(record)) {
          const saved = await putRecordWithoutBackup({ ...nextRecord, updated_at: record.updated_at });
          setRecords((current) => current.map((item) => (item.id === saved.id ? saved : item)));
          if (selectedId === saved.id) {
            setDetailDraft(formFromRecord(saved));
          }
          changed += 1;
        }
        const applyElapsedMs = Math.round(performance.now() - applyStartedAt);
        reportItems.push({
          recordId: record.id,
          title: result.title || record.title || record.summary || record.raw_input || record.id,
          ok: result.ok,
          changed: JSON.stringify(nextRecord) !== JSON.stringify(record),
          elapsedMs: Math.round(result.elapsedMs || 0),
          taskElapsedMs: Math.round(result.taskElapsedMs || 0),
          calendarElapsedMs: Math.round(result.calendarElapsedMs || 0),
          applyElapsedMs,
          hasTask: Boolean(result.hasTask),
          hasCalendar: Boolean(result.hasCalendar),
          error: result.error || "",
        });
        setManualProgress({
          phase: "applying",
          applied: index + 1,
          changed,
          failed,
          applyingElapsedMs: Math.round(performance.now() - applyingStartedAt),
          reportItems,
          message: `CGMPへ反映中 ${index + 1}/${targets.length}`,
          currentTitle: record.title || record.summary || record.raw_input || record.id,
        });
      }
      const applyingElapsedMs = Math.round(performance.now() - applyingStartedAt);
      const reloadStartedAt = performance.now();
      await Promise.all([reloadRecords(), reloadBackupSummary()]);
      const reloadElapsedMs = Math.round(performance.now() - reloadStartedAt);
      const finishedAt = performance.now();
      if (showNotice) {
        console.table(
          reportItems.map((item) => ({
            title: item.title,
            ok: item.ok,
            changed: item.changed,
            total_ms: item.elapsedMs,
            task_ms: item.taskElapsedMs,
            calendar_ms: item.calendarElapsedMs,
            apply_ms: item.applyElapsedMs,
            error: item.error,
          }))
        );
        console.debug("[cgmp:google-sync] report", {
          total: targets.length,
          changed,
          failed,
          checkingElapsedMs,
          applyingElapsedMs,
          reloadElapsedMs,
          totalElapsedMs: Math.round(finishedAt - startedAt),
          slowest: [...reportItems].sort((a, b) => b.elapsedMs + b.applyElapsedMs - (a.elapsedMs + a.applyElapsedMs)).slice(0, 8),
        });
      }
      setManualProgress({
        phase: "done",
        applied: targets.length,
        changed,
        failed,
        message: failed > 0 ? `同期完了: 更新${changed}件 / 失敗${failed}件` : `同期完了: 更新${changed}件`,
        currentTitle: "",
        checkingElapsedMs,
        applyingElapsedMs,
        reloadElapsedMs,
        reportItems,
        finishedAt,
      });
      finishSyncActivity(activityId, failed > 0 ? "error" : "done", failed > 0 ? "Google sync warning" : "Google sync complete", `更新${changed} / 失敗${failed}`);
      if (showNotice) {
        setNotice({
          kind: failed > 0 ? "error" : "info",
          text: failed > 0 ? `Google状態を同期しました（更新${changed}件 / 失敗${failed}件）。` : `Google状態を同期しました（更新${changed}件）。`,
        });
      }
    } catch (error) {
      setManualProgress({
        phase: "error",
        message: error instanceof Error ? error.message : "Google状態同期に失敗しました",
        finishedAt: performance.now(),
      });
      if (showNotice) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Google状態同期に失敗しました",
        });
      }
      finishSyncActivity(
        activityId,
        "error",
        "Google sync failed",
        error instanceof Error ? error.message : "Google状態同期に失敗しました"
      );
    } finally {
      setExternalSyncing(false);
    }
  }

  async function registerGoogleTaskRecord(
    record: CGMPRecord,
    options: { backupAfterSave?: boolean; showNotice?: boolean } = {}
  ) {
    const backupAfterSave = options.backupAfterSave !== false;
    const showNotice = options.showNotice !== false;
    const processingKey = `task:${record.id}`;
    const activityId = startSyncActivity("Sync Reminder", record.title || record.summary || "Google Tasks", "登録中");
    setExternalProcessingKey(processingKey);
    try {
      const response = await fetch("/api/external/google/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record }),
      });
      const payload = (await response.json().catch(() => ({}))) as GoogleTaskPayload;
      if (!response.ok || !payload.ok || !payload.taskId || !payload.taskListId) {
        throw new Error(payload.error || "GOOGLE_TASK_CREATE_FAILED");
      }
      const saved = await saveExternalRecordUpdate({
        ...record,
        updated_at: new Date().toISOString(),
        external_action_status: "registered",
        external_target: "reminder",
        external_registered_at: payload.updatedAt || new Date().toISOString(),
        external_error: "",
        google_task_id: payload.taskId,
        google_task_list_id: payload.taskListId,
        google_task_status: payload.status || "needsAction",
        google_task_updated_at: payload.updatedAt || new Date().toISOString(),
      }, { backup: backupAfterSave });
      if (showNotice) {
        setNotice({ kind: "info", text: "Google Tasksへ登録しました。" });
      }
      finishSyncActivity(activityId, "done", "Reminder synced", record.title || "Google Tasks");
      return saved;
    } catch (error) {
      const saved = await saveExternalRecordUpdate({
        ...record,
        external_action_status: "failed",
        external_target: "reminder",
        external_error: error instanceof Error ? error.message : "Google Tasks登録に失敗しました",
      }, { backup: backupAfterSave });
      if (showNotice) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Google Tasks登録に失敗しました",
        });
      }
      finishSyncActivity(activityId, "error", "Reminder sync failed", error instanceof Error ? error.message : "Google Tasks登録に失敗しました");
      return saved;
    } finally {
      setExternalProcessingKey("");
    }
  }

  async function registerGoogleTask(recordId: string) {
    const record = records.find((candidate) => candidate.id === recordId);
    if (!record) return;
    await registerGoogleTaskRecord(record);
  }

  async function toggleGoogleTaskStatus(recordId: string) {
    const record = records.find((candidate) => candidate.id === recordId);
    if (!record?.google_task_id || !record.google_task_list_id) return;
    const nextStatus: Exclude<CGMPGoogleTaskStatus, ""> =
      record.google_task_status === "completed" ? "needsAction" : "completed";
    const processingKey = `task-status:${recordId}`;
    const activityId = startSyncActivity(
      "Sync Reminder",
      record.title || record.summary || "Google Tasks",
      nextStatus === "completed" ? "完了へ更新中" : "未完了へ更新中"
    );
    setExternalProcessingKey(processingKey);
    try {
      const response = await fetch("/api/external/google/task", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskListId: record.google_task_list_id,
          taskId: record.google_task_id,
          status: nextStatus,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GoogleTaskPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "GOOGLE_TASK_UPDATE_FAILED");
      }
      await saveExternalRecordUpdate({
        ...record,
        updated_at: new Date().toISOString(),
        external_action_status: "registered",
        external_error: "",
        google_task_status: payload.status || nextStatus,
        google_task_updated_at: payload.updatedAt || new Date().toISOString(),
      });
      setNotice({ kind: "info", text: nextStatus === "completed" ? "Google Tasksを完了にしました。" : "Google Tasksを未完了に戻しました。" });
      finishSyncActivity(activityId, "done", "Reminder synced", record.title || "Google Tasks");
    } catch (error) {
      await saveExternalRecordUpdate({
        ...record,
        external_action_status: "failed",
        external_error: error instanceof Error ? error.message : "Google Tasks更新に失敗しました",
      });
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Google Tasks更新に失敗しました",
      });
      finishSyncActivity(activityId, "error", "Reminder sync failed", error instanceof Error ? error.message : "Google Tasks更新に失敗しました");
    } finally {
      setExternalProcessingKey("");
    }
  }

  async function registerGoogleCalendarRecord(
    record: CGMPRecord,
    options: { backupAfterSave?: boolean; showNotice?: boolean } = {}
  ) {
    const backupAfterSave = options.backupAfterSave !== false;
    const showNotice = options.showNotice !== false;
    const processingKey = `calendar:${record.id}`;
    const activityId = startSyncActivity("Sync Calendar", record.title || record.summary || "Google Calendar", "登録中");
    setExternalProcessingKey(processingKey);
    try {
      const response = await fetch("/api/external/google/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record }),
      });
      const payload = (await response.json().catch(() => ({}))) as GoogleCalendarPayload;
      if (!response.ok || !payload.ok || !payload.eventId || !payload.calendarId) {
        throw new Error(payload.error || "GOOGLE_CALENDAR_CREATE_FAILED");
      }
      const saved = await saveExternalRecordUpdate({
        ...record,
        updated_at: new Date().toISOString(),
        external_action_status: "registered",
        external_target: "calendar",
        external_registered_at: payload.updatedAt || new Date().toISOString(),
        external_error: "",
        google_calendar_event_id: payload.eventId,
        google_calendar_id: payload.calendarId,
        google_calendar_updated_at: payload.updatedAt || new Date().toISOString(),
      }, { backup: backupAfterSave });
      if (showNotice) {
        setNotice({ kind: "info", text: "Google Calendarへ登録しました。" });
      }
      finishSyncActivity(activityId, "done", "Calendar synced", record.title || "Google Calendar");
      return saved;
    } catch (error) {
      const saved = await saveExternalRecordUpdate({
        ...record,
        external_action_status: "failed",
        external_target: "calendar",
        external_error: error instanceof Error ? error.message : "Google Calendar登録に失敗しました",
      }, { backup: backupAfterSave });
      if (showNotice) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Google Calendar登録に失敗しました",
        });
      }
      finishSyncActivity(activityId, "error", "Calendar sync failed", error instanceof Error ? error.message : "Google Calendar登録に失敗しました");
      return saved;
    } finally {
      setExternalProcessingKey("");
    }
  }

  async function registerGoogleCalendarEvent(recordId: string) {
    const record = records.find((candidate) => candidate.id === recordId);
    if (!record) return;
    await registerGoogleCalendarRecord(record);
  }

  async function rebackupAllRecords() {
    if (backupProcessing) {
      const now = performance.now();
      setBackupSyncProgress({
        phase: "processing",
        message: "別の同期が実行中です。完了後にもう一度試してください。",
        startedAt: now,
        total: 0,
        succeeded: 0,
        failed: 0,
        processElapsedMs: 0,
        reloadElapsedMs: 0,
        reportItems: [],
      });
      return;
    }

    const startedAt = performance.now();
    const activityId = startSyncActivity("Uploading", "Google Drive", "全件再同期を準備中");
    setBackupSyncProgress({
      phase: "processing",
      message: "全件をGoogle Driveへ再同期しています。",
      startedAt,
      total: 0,
      succeeded: 0,
      failed: 0,
      processElapsedMs: 0,
      reloadElapsedMs: 0,
      reportItems: [],
    });
    setBackupProcessing(true);
    try {
      const queued = await enqueueAllRecordsForBackup();
      updateSyncActivity(activityId, { label: "Uploading", title: "Google Drive", detail: `対象${queued}件` });
      setBackupSyncProgress((current) =>
        current
          ? {
              ...current,
              message: `全件再同期の対象をキューに入れました（対象${queued}件）。`,
              total: queued,
            }
          : current
      );
      const processStartedAt = performance.now();
      const results = await processBackupQueue({
        force: true,
        onProgress: (progress) => {
          updateSyncActivity(activityId, {
            label: getBackupActivityLabel(progress.stage),
            title: progress.currentTitle || "Google Drive",
            detail: `${getBackupStageLabel(progress.stage)} ${progress.completed}/${progress.total}`,
          });
          setBackupSyncProgress((current) => {
            if (!current || current.phase !== "processing") return current;
            const newItems = backupResultsToReportItems(progress.results);
            const reportItems = [...current.reportItems, ...newItems];
            const failed = reportItems.filter((item) => !item.ok).length;
            const completed = Math.max(reportItems.length, progress.completed);
            return {
              ...current,
              message: progress.currentTitle
                ? `${getBackupStageLabel(progress.stage)}: ${progress.currentTitle}（${progress.completed}/${progress.total}）`
                : `全件再同期中（${progress.completed}/${progress.total}）`,
              total: Math.max(current.total, progress.total, completed),
              succeeded: reportItems.length - failed,
              failed,
              processElapsedMs: Math.round(performance.now() - processStartedAt),
              reportItems,
            };
          });
        },
      });
      const processElapsedMs = Math.round(performance.now() - processStartedAt);
      const reloadStartedAt = performance.now();
      await Promise.all([reloadRecords(), reloadBackupSummary()]);
      const reloadElapsedMs = Math.round(performance.now() - reloadStartedAt);
      const failed = results.filter((result) => !result.ok).length;
      const reportItems = backupResultsToReportItems(results);
      const skipped = reportItems.filter((item) => item.skipped).length;
      const finishedAt = performance.now();
      console.table(
        reportItems.map((item) => ({
          title: item.title,
          ok: item.ok,
          skipped: item.skipped,
          type: item.itemType,
          attachment: item.attachmentId,
          total_ms: item.elapsedMs,
          blob_ms: item.blobElapsedMs,
          upload_ms: item.uploadElapsedMs,
          preview_kb: Math.round(item.previewSizeBytes / 1024),
          error: item.error,
        }))
      );
      console.debug("[cgmp:drive-sync:force-all] report", {
        queued,
        total: results.length,
        succeeded: results.length - failed,
        failed,
        skipped,
        processElapsedMs,
        reloadElapsedMs,
        totalElapsedMs: Math.round(finishedAt - startedAt),
        slowest: [...reportItems].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 12),
      });
      setBackupSyncProgress({
        phase: "done",
        message:
          failed > 0
            ? `全件再同期で失敗があります（成功${results.length - failed} / 失敗${failed}）。`
            : skipped > 0
              ? `全件再同期が完了しました（成功${results.length - skipped} / スキップ${skipped}）。`
              : `全件再同期が完了しました（処理${results.length}件）。`,
        startedAt,
        finishedAt,
        total: results.length,
        succeeded: results.length - failed,
        failed,
        processElapsedMs,
        reloadElapsedMs,
        reportItems,
      });
      setNotice({
        kind: failed > 0 ? "error" : "info",
        text:
          failed > 0
            ? `全件再同期で失敗があります（${failed}件）。もう一度実行できます。`
            : `全件再同期を実行しました（対象${queued}件 / 処理${results.length}件）。`,
      });
      finishSyncActivity(
        activityId,
        failed > 0 ? "error" : "done",
        failed > 0 ? "Upload failed" : "Upload complete",
        failed > 0 ? `成功${results.length - failed} / 失敗${failed}` : `処理${results.length}`
      );
    } catch (error) {
      setBackupSyncProgress({
        phase: "error",
        message: error instanceof Error ? error.message : "全件再同期に失敗しました",
        startedAt,
        finishedAt: performance.now(),
        total: 0,
        succeeded: 0,
        failed: 1,
        processElapsedMs: Math.round(performance.now() - startedAt),
        reloadElapsedMs: 0,
        reportItems: [],
      });
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "全件再同期に失敗しました",
      });
      finishSyncActivity(activityId, "error", "Upload failed", error instanceof Error ? error.message : "全件再同期に失敗しました");
    } finally {
      setBackupProcessing(false);
    }
  }

  async function confirmExternalRegistration() {
    if (!externalConfirm) return;
    const target = externalConfirm;
    setExternalConfirm(null);
    setSelectedId(target.recordId);
    if (target.action === "reminder") {
      await registerGoogleTask(target.recordId);
      return;
    }
    await registerGoogleCalendarEvent(target.recordId);
  }

  async function loadDriveBackupList() {
    setDriveBackupLoading(true);
    try {
      const response = await fetch("/api/backup/restore");
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        records?: DriveBackupRecordPreview[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "バックアップ一覧の取得に失敗しました");
      }
      const previews = (Array.isArray(payload.records) ? payload.records : []).map((item) => {
        const record = item.record || {};
        return {
          ...item,
          title: item.title || record.title || item.id,
          summary: item.summary || record.summary || "",
          action: item.action || record.action || "note",
          domain: item.domain || record.domain || "other",
          para: item.para || record.para || "",
          updated_at: item.updated_at || record.updated_at || "",
          backed_up_at: item.backed_up_at || item.uploaded_at || "",
          file_id: item.file_id || item.pathname || "",
          checksum: item.checksum || "",
        };
      });
      setDriveBackupRecords(previews);
      setDriveBackupCheckedAt(new Date().toISOString());
      setNotice({ kind: "info", text: "Google Drive上の正本一覧を取得しました。" });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "バックアップ一覧の取得に失敗しました",
      });
    } finally {
      setDriveBackupLoading(false);
    }
  }

  async function importMissingFromDrive(showNotice = false) {
    if (driveImporting) return;
    setDriveImporting(true);
    const activityId = startSyncActivity("Downloading", "Google Drive", "差分を確認中");
    try {
      const result = await importMissingRecordsFromDrive();
      updateSyncActivity(activityId, {
        label: "Downloading",
        title: "Google Drive",
        detail: `追加${result.imported.length} / 画像${result.hydratedAttachments}`,
      });
      await Promise.all([reloadRecords(), reloadBackupSummary(), reloadDeletedRecordsSummary()]);
      if (showNotice || result.imported.length > 0 || result.deleted.length > 0) {
        setNotice({
          kind: "info",
          text:
            result.imported.length > 0 || result.merged.length > 0 || result.deleted.length > 0 || result.hydratedAttachments > 0
              ? `Drive同期: メモ追加${result.imported.length}件 / 削除反映${result.deleted.length}件 / 写真メタ更新${result.merged.length}件 / 画像復元${result.hydratedAttachments}件`
              : "Driveから追加する未取り込みメモはありません。",
        });
      }
      finishSyncActivity(
        activityId,
        "done",
        "Download complete",
        `追加${result.imported.length} / 削除${result.deleted.length} / 画像${result.hydratedAttachments}`
      );
    } catch (error) {
      if (showNotice) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Driveからの取り込みに失敗しました",
        });
      }
      finishSyncActivity(
        activityId,
        "error",
        "Download failed",
        error instanceof Error ? error.message : "Driveからの取り込みに失敗しました"
      );
    } finally {
      setDriveImporting(false);
    }
  }

  async function createOrRefreshEmbedding(record: CGMPRecord, force = false) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("オフラインのためembedding生成をスキップしました");
    }
    return ensureRecordEmbedding({
      record,
      provider: embeddingProviderRef.current,
      force,
    });
  }

  async function reloadEmbeddingIndexStats() {
    const index = await loadEmbeddingIndex();
    const latestEmbeddedAt = index.reduce((latest, item) => {
      if (!latest) return item.embedded_at;
      return item.embedded_at > latest ? item.embedded_at : latest;
    }, "");
    const first = index[0];
    setEmbeddingIndexStats({
      count: index.length,
      dimensions: first?.dimensions || 0,
      latestEmbeddedAt,
      model: first?.model || "text-embedding-3-small",
    });
  }

  async function reloadSemanticIconState() {
    const [dictionary, index] = await Promise.all([loadSemanticIconDictionary(), loadSemanticIconIndex()]);
    setSemanticIconDictionary(dictionary);
    setSemanticIconIndexStats({
      dictionaryCount: dictionary.length,
      indexCount: index.length,
      latestEmbeddedAt: index.reduce((latest, item) => {
        if (!latest) return item.embedded_at;
        return item.embedded_at > latest ? item.embedded_at : latest;
      }, ""),
      model: index[0]?.model || "text-embedding-3-small",
    });
  }

  async function assignSemanticIcon(record: CGMPRecord, force = false, thresholdOverride?: number) {
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) return record;
      const quickHash = await hashEmbeddingText(buildRecordIconText(record));
      if (!force && record.icon?.text_hash === quickHash && record.icon?.emoji) return record;

      const iconIndex = await loadSemanticIconIndex();
      if (iconIndex.length === 0) {
        return record;
      }
      const { index } = await createOrRefreshEmbedding(record, false);
      const result = await inferSemanticIconForRecord({
        record,
        provider: embeddingProviderRef.current,
        threshold: thresholdOverride ?? settingsDraft?.semantic_icon_threshold ?? DEFAULT_SEMANTIC_ICON_THRESHOLD,
        recordVector: index.vector,
      });
      const nextRecord = { ...record, icon: result.icon };
      const saved = await upsertRecord({ ...nextRecord, updated_at: record.updated_at });
      setRecords((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      return saved;
    } catch (error) {
      console.debug("[cgmp:semantic-icon] assignment failed", {
        record_id: record.id,
        error,
      });
      return record;
    }
  }

  async function rebuildSemanticIconDictionaryIndex(force = false) {
    if (semanticIconProgress?.running) return;
    setSemanticIconProgress({
      running: true,
      mode: "dictionary",
      total: semanticIconDictionary.length,
      completed: 0,
      skipped: 0,
      failed: 0,
      currentTitle: "",
      errors: [],
    });
    try {
      if (force) await clearSemanticIconIndex();
      await ensureSemanticIconDictionaryIndex({
        provider: embeddingProviderRef.current,
        force,
        onProgress: (progress) => {
          setSemanticIconProgress((prev) =>
            prev
              ? {
                  ...prev,
                  total: progress.total,
                  completed: progress.completed,
                  currentTitle: progress.currentLabel,
                }
              : prev
          );
        },
      });
      await reloadSemanticIconState();
      setSemanticIconProgress((prev) =>
        prev ? { ...prev, running: false, currentTitle: "", skipped: 0, failed: 0 } : prev
      );
      setNotice({ kind: "info", text: "Semantic icon辞書のembeddingを更新しました。" });
    } catch (error) {
      setSemanticIconProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              failed: prev.failed + 1,
              errors: [error instanceof Error ? error.message : String(error)],
            }
          : prev
      );
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Icon辞書embeddingに失敗しました" });
    }
  }

  async function reassignSemanticIcons(force = false) {
    if (semanticIconProgress?.running) return;
    const threshold = settingsDraft?.semantic_icon_threshold ?? DEFAULT_SEMANTIC_ICON_THRESHOLD;
    if (settingsDraft) {
      try {
        const savedSettings = await saveSettings(settingsDraft);
        setSettingsDraft(savedSettings);
      } catch (error) {
        console.debug("[cgmp:semantic-icon] failed to persist threshold before reassign", error);
      }
    }
    const targets = force ? records : records.filter((record) => !record.icon?.emoji);
    setSemanticIconProgress({
      running: true,
      mode: "records",
      total: targets.length,
      completed: 0,
      skipped: records.length - targets.length,
      failed: 0,
      currentTitle: targets[0]?.title || "",
      errors: [],
    });
    if (targets.length === 0) {
      setSemanticIconProgress((prev) => (prev ? { ...prev, running: false, currentTitle: "" } : prev));
      setNotice({ kind: "info", text: "Icon再推定が必要なメモはありません。" });
      return;
    }
    let completed = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const record of targets) {
      setSemanticIconProgress((prev) => (prev ? { ...prev, currentTitle: record.title || record.id } : prev));
      try {
        await assignSemanticIcon(record, true, threshold);
        completed += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${record.id}: ${error instanceof Error ? error.message : "ICON_ASSIGN_FAILED"}`);
      }
      setSemanticIconProgress((prev) =>
        prev
          ? {
              ...prev,
              completed,
              failed,
              errors: errors.slice(-20),
            }
          : prev
      );
    }
    await reloadRecords();
    setSemanticIconProgress((prev) =>
      prev
        ? {
            ...prev,
            running: false,
            completed,
            failed,
            currentTitle: "",
            errors: errors.slice(-20),
          }
        : prev
    );
    setNotice({
      kind: failed > 0 ? "error" : "info",
      text: `Semantic icon再推定が完了しました（完了${completed}件 / 失敗${failed}件）。`,
    });
  }

  async function addSemanticIconEntry(entry: CGMPSemanticIconEntry) {
    const next = [
      ...semanticIconDictionary.filter((item) => item.key !== entry.key),
      {
        ...entry,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
    ];
    const saved = await saveSemanticIconDictionary(next);
    setSemanticIconDictionary(saved);
    await clearSemanticIconIndex();
    await reloadSemanticIconState();
    setNotice({ kind: "info", text: "Semantic icon辞書に追加しました。辞書embeddingを再作成してください。" });
  }

  async function resetSemanticIconsToDefault() {
    const saved = await resetSemanticIconDictionary();
    await clearSemanticIconIndex();
    setSemanticIconDictionary(saved);
    await reloadSemanticIconState();
    setNotice({ kind: "info", text: "Semantic icon辞書を初期値に戻しました。" });
  }

  async function suggestRelatedRecords(record: CGMPRecord) {
    try {
      const { index } = await createOrRefreshEmbedding(record, true);
      void assignSemanticIcon(record, false);
      const candidates = (await loadAllRecords()).filter((candidate) => candidate.id !== record.id);
      const results = await searchSimilarByVector({
        vector: index.vector,
        records: candidates,
        excludeRecordId: record.id,
        limit: 5,
        threshold: SEMANTIC_CANDIDATE_THRESHOLD,
      });
      if (results.length > 0) {
        setRelatedCandidates(results);
      }
      void reloadEmbeddingIndexStats();
    } catch (error) {
      console.debug("[cgmp:embedding] related suggestion failed", {
        record_id: record.id,
        error,
      });
    }
  }

  async function rebuildEmbeddingIndex(force = false) {
    if (embeddingProgress?.running) return;
    embeddingCancelRef.current = false;
    const startedRecords = [...records];
    const existing = await loadEmbeddingIndex();
    const existingById = new Map(existing.map((item) => [item.record_id, item]));
    const targets: CGMPRecord[] = [];
    for (const record of startedRecords) {
      if (force) {
        targets.push(record);
        continue;
      }
      const text = buildEmbeddingText(record);
      const hash = await hashEmbeddingText(text);
      const current = existingById.get(record.id);
      if (!current || current.embedding_text_hash !== hash) {
        targets.push(record);
      }
    }

    setEmbeddingProgress({
      running: true,
      total: targets.length,
      completed: 0,
      skipped: startedRecords.length - targets.length,
      failed: 0,
      currentTitle: targets[0]?.title || "",
      force,
      errors: [],
    });

    if (targets.length === 0) {
      setEmbeddingProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              currentTitle: "",
            }
          : prev
      );
      setNotice({ kind: "info", text: "更新が必要なembeddingはありません。" });
      void reloadEmbeddingIndexStats();
      return;
    }

    let completed = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const record of targets) {
      if (embeddingCancelRef.current) break;
      setEmbeddingProgress((prev) => (prev ? { ...prev, currentTitle: record.title || record.summary || record.id } : prev));
      try {
        await createOrRefreshEmbedding(record, force);
        completed += 1;
      } catch (error) {
        failed += 1;
        const message = `${record.id}: ${error instanceof Error ? error.message : "EMBEDDING_FAILED"}`;
        errors.push(message);
        console.debug("[cgmp:embedding] embedding generation failed", {
          record_id: record.id,
          error,
        });
      }
      setEmbeddingProgress((prev) =>
        prev
          ? {
              ...prev,
              completed,
              failed,
              errors: errors.slice(-20),
            }
          : prev
      );
    }

    setEmbeddingProgress((prev) =>
      prev
        ? {
            ...prev,
            running: false,
            completed,
            failed,
            currentTitle: embeddingCancelRef.current ? "中断しました" : "",
            errors: errors.slice(-20),
          }
        : prev
    );
    setNotice({
      kind: failed > 0 ? "error" : "info",
      text: embeddingCancelRef.current
        ? `embedding作成を中断しました（完了${completed}件 / 失敗${failed}件）。`
        : `embedding作成が完了しました（完了${completed}件 / 失敗${failed}件）。`,
    });
    void reloadEmbeddingIndexStats();
  }

  useEffect(() => {
    const storedTheme = readStoredTheme();
    setThemeMode(storedTheme);
    applyTheme(storedTheme);
  }, []);

  useEffect(() => {
    if (themeMode !== "system") return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [
          nextRecords,
          nextSettings,
          nextBackupSummary,
          nextDeletedRecords,
          nextEmbeddingIndex,
          nextSemanticIconDictionary,
          nextSemanticIconIndex,
        ] = await Promise.all([
          loadAllRecords(),
          loadSettings(),
          getBackupStatus(),
          loadDeletedRecords(),
          loadEmbeddingIndex(),
          loadSemanticIconDictionary(),
          loadSemanticIconIndex(),
        ]);
        if (cancelled) return;
        setRecords(nextRecords);
        setSettingsDraft(nextSettings);
        setBackupSummary(nextBackupSummary);
        setDeletedRecordsSummary({
          count: nextDeletedRecords.length,
          latestDeletedAt: nextDeletedRecords[0]?.deleted_at || "",
        });
        setEmbeddingIndexStats({
          count: nextEmbeddingIndex.length,
          dimensions: nextEmbeddingIndex[0]?.dimensions || 0,
          latestEmbeddedAt: nextEmbeddingIndex.reduce((latest, item) => {
            if (!latest) return item.embedded_at;
            return item.embedded_at > latest ? item.embedded_at : latest;
          }, ""),
          model: nextEmbeddingIndex[0]?.model || "text-embedding-3-small",
        });
        setSemanticIconDictionary(nextSemanticIconDictionary);
        setSemanticIconIndexStats({
          dictionaryCount: nextSemanticIconDictionary.length,
          indexCount: nextSemanticIconIndex.length,
          latestEmbeddedAt: nextSemanticIconIndex.reduce((latest, item) => {
            if (!latest) return item.embedded_at;
            return item.embedded_at > latest ? item.embedded_at : latest;
          }, ""),
          model: nextSemanticIconIndex[0]?.model || "text-embedding-3-small",
        });
        setSelectedId(null);
        setIsReady(true);
      } catch (error) {
        if (cancelled) return;
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "初期化に失敗しました",
        });
        setIsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selected = records.find((record) => record.id === selectedId) ?? null;
    setDetailDraft(selected ? formFromRecord(selected) : null);
    if (!selected) {
      setIsEditPanelOpen(false);
    }
  }, [records, selectedId, reloadTick]);

  useEffect(() => {
    if (!pendingMiniJumpId) return;
    if (tab !== "home") return;
    if (selectedId !== pendingMiniJumpId) return;

    const timer = window.setTimeout(() => {
      const element = document.getElementById(`record-card-${pendingMiniJumpId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingMiniJumpId(null);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [pendingMiniJumpId, selectedId, tab]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === "error" ? 9000 : 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (tab !== "settings" || deployInfo) return;
    const requestId = deployInfoRequestIdRef.current + 1;
    deployInfoRequestIdRef.current = requestId;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    setDeployInfoLoading(true);

    void (async () => {
      try {
        const response = await fetch("/api/deploy-info", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as DeployInfo & { message?: string };
        if (!response.ok) {
          throw new Error(payload.message || `更新情報を取得できませんでした (${response.status})`);
        }
        if (deployInfoRequestIdRef.current === requestId) setDeployInfo(payload);
      } catch (error) {
        if (deployInfoRequestIdRef.current === requestId) {
          const isAbortError = error instanceof DOMException && error.name === "AbortError";
          setDeployInfo({
            ok: false,
            commitMessage: isAbortError
              ? "更新情報の取得がタイムアウトしました。"
              : error instanceof Error
                ? error.message
                : "更新情報を取得できませんでした",
            generatedAt: new Date().toISOString(),
          });
        }
      } finally {
        window.clearTimeout(timeout);
        if (deployInfoRequestIdRef.current === requestId) setDeployInfoLoading(false);
      }
    })();

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [deployInfo, tab]);

  useEffect(() => {
    if (!isPromptEditorOpen) return;
    const scrollY = window.scrollY;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;
    const originalOverflow = document.body.style.overflow;

    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      document.body.style.overflow = originalOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [isPromptEditorOpen]);

  useEffect(() => {
    if (!aiProcessingOverlay) return;

    if (typeof aiProcessingOverlay.finishedAt === "number") {
      setAiProcessingElapsedMs(Math.round(aiProcessingOverlay.finishedAt - aiProcessingOverlay.startedAt));
      return;
    }

    const timer = window.setInterval(() => {
      setAiProcessingElapsedMs(Math.round(performance.now() - aiProcessingOverlay.startedAt));
    }, 33);

    return () => window.clearInterval(timer);
  }, [aiProcessingOverlay]);

  useEffect(() => {
    if (!backupSyncProgress || backupSyncProgress.phase !== "processing") return;

    setBackupProgressNow(performance.now());
    const timer = window.setInterval(() => {
      setBackupProgressNow(performance.now());
    }, 100);

    return () => window.clearInterval(timer);
  }, [backupSyncProgress?.phase, backupSyncProgress?.startedAt]);

  useEffect(() => {
    if (!webhookTestRunning || !webhookTestStartedAt) return;

    setWebhookTestElapsedMs(Math.round(performance.now() - webhookTestStartedAt));
    const timer = window.setInterval(() => {
      setWebhookTestElapsedMs(Math.round(performance.now() - webhookTestStartedAt));
    }, 100);

    return () => window.clearInterval(timer);
  }, [webhookTestRunning, webhookTestStartedAt]);

  useEffect(() => {
    return () => {
      if (aiProcessingHideTimerRef.current !== null) {
        window.clearTimeout(aiProcessingHideTimerRef.current);
      }
      if (syncActivityHideTimerRef.current !== null) {
        window.clearTimeout(syncActivityHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (tab !== "compose") return;
    const timer = window.setTimeout(() => {
      composeRawInputRef.current?.focus();
      composeRawInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab, composeFocusTick]);

  useEffect(() => {
    if (tab !== "compose" || composeAiStatus !== "done") return;
    const timer = window.setTimeout(() => {
      confirmSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [composeAiStatus, tab]);

  useEffect(() => {
    if (!isReady) return;
    if (initialExternalSyncDoneRef.current) return;
    if (!records.some((record) => shouldSyncExternalRecord(record, settingsDraft))) return;
    initialExternalSyncDoneRef.current = true;
    void syncExternalStatuses(false);
  }, [isReady, records, settingsDraft]);

  useEffect(() => {
    if (!isReady) return;
    if (!initialDriveImportDoneRef.current) {
      initialDriveImportDoneRef.current = true;
      void importMissingFromDrive(false);
    }
    void runBackupQueue(false);
    void hydrateMissingAttachmentBlobs().then((result) => {
      if (result.hydrated > 0) {
        void reloadRecords();
      }
    });

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void runBackupQueue(false);
        void importMissingFromDrive(false);
        void syncExternalStatuses(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, [isReady]);

  const baseFilteredRecords = useMemo(() => {
    return records.filter((record) => {
      const tag = tagQuery.trim().toLowerCase();
      const tagOk =
        !tag ||
        (record.tags || []).some((item) => String(item || "").toLowerCase().includes(tag));
      const actionOk = actionFilter === "all" || record.action === actionFilter;
      const domainOk = domainFilter === "all" || record.domain === domainFilter;
      const paraOk = paraFilter === "all" || getEffectivePara(record) === paraFilter;
      return tagOk && actionOk && domainOk && paraOk;
    });
  }, [records, tagQuery, actionFilter, domainFilter, paraFilter]);
  const semanticSearchThreshold = normalizeSemanticThreshold(settingsDraft?.semantic_search_threshold);
  const semanticSearchResultMode: CGMPSemanticSearchResultMode =
    settingsDraft?.semantic_search_result_mode === "top10" ? "top10" : "threshold";

  useEffect(() => {
    if (searchMode !== "semantic") {
      setSemanticSearching(false);
      setSemanticError("");
      setSemanticResults([]);
      return;
    }
    const text = query.trim();
    if (!text) {
      setSemanticSearching(false);
      setSemanticError("");
      setSemanticResults([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSemanticSearching(true);
      setSemanticError("");
      void searchSimilarByText({
        text,
        records: baseFilteredRecords,
        provider: embeddingProviderRef.current,
        limit: semanticSearchResultMode === "top10" ? 10 : 20,
        threshold: semanticSearchResultMode === "top10" ? -1 : semanticSearchThreshold,
      })
        .then((results) => {
          if (cancelled) return;
          setSemanticResults(
            results.map((item) => ({
              recordId: item.record.id,
              score: item.score,
              level: item.level,
            }))
          );
        })
        .catch((error) => {
          if (cancelled) return;
          console.debug("[cgmp:embedding] semantic search failed", error);
          setSemanticError(error instanceof Error ? error.message : "意味検索に失敗しました");
          setSemanticResults([]);
        })
        .finally(() => {
          if (!cancelled) setSemanticSearching(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchMode, query, baseFilteredRecords, semanticSearchResultMode, semanticSearchThreshold]);

  const filteredRecords = useMemo(() => {
    const tagged =
      searchMode === "semantic" && query.trim()
        ? semanticResults
            .map((result) => baseFilteredRecords.find((record) => record.id === result.recordId))
            .filter((record): record is CGMPRecord => Boolean(record))
        : baseFilteredRecords.filter((record) => matchesQuery(record, query, ""));

    return tagged.sort((a, b) => {
      if (searchMode === "semantic" && query.trim()) {
        const scoreById = new Map(semanticResults.map((result) => [result.recordId, result.score]));
        const aScore = scoreById.get(a.id) || 0;
        const bScore = scoreById.get(b.id) || 0;
        if (aScore !== bScore) return bScore - aScore;
      }
      if (sortKey === "datetime") {
        const aValue = getDateSortValue(a);
        const bValue = getDateSortValue(b);
        if (aValue === bValue) return String(b.id).localeCompare(String(a.id));
        return bValue - aValue;
      }
      if (sortKey === "created_at") {
        const aValue = new Date(a.created_at || a.updated_at).getTime();
        const bValue = new Date(b.created_at || b.updated_at).getTime();
        if (aValue === bValue) return String(b.id).localeCompare(String(a.id));
        return bValue - aValue;
      }

      const aValue = new Date(a.updated_at || a.created_at).getTime();
      const bValue = new Date(b.updated_at || b.created_at).getTime();
      if (aValue === bValue) return String(b.id).localeCompare(String(a.id));
      return bValue - aValue;
    });
  }, [baseFilteredRecords, query, searchMode, semanticResults, sortKey]);

  const selectedRecord = useMemo(() => records.find((record) => record.id === selectedId) ?? null, [records, selectedId]);
  const miniFilteredRecords = useMemo(() => {
    return records.filter((record) => matchesMiniQuery(record, miniListQuery));
  }, [records, miniListQuery]);
  const checkedCount = checkedRecordIds.length;
  const allFilteredChecked =
    filteredRecords.length > 0 && filteredRecords.every((record) => checkedRecordIds.includes(record.id));
  const activeFilterCount = [
    tagQuery.trim(),
    actionFilter !== "all",
    domainFilter !== "all",
    paraFilter !== "all",
    sortKey !== "updated_at",
  ].filter(Boolean).length;
  const semanticStatusText = (() => {
    if (semanticSearching) return "意味検索中...";
    if (semanticError) return `意味検索エラー: ${semanticError}`;
    if (!query.trim()) return "検索語を入力";
    if ((embeddingIndexStats?.count || 0) === 0) return "インデックス未作成";
    return semanticSearchResultMode === "top10"
      ? `近い順 Top${semanticResults.length} / index ${embeddingIndexStats?.count || 0}件`
      : `${semanticResults.length}件 / 閾値 ${semanticSearchThreshold.toFixed(2)} / index ${embeddingIndexStats?.count || 0}件`;
  })();

  function toggleCheckedRecord(id: string) {
    setCheckedRecordIds((current) =>
      current.includes(id) ? current.filter((recordId) => recordId !== id) : [...current, id]
    );
  }

  function toggleAllFilteredRecords() {
    setCheckedRecordIds((current) => {
      const filteredIds = filteredRecords.map((record) => record.id);
      if (filteredIds.length === 0) return current;
      if (filteredIds.every((id) => current.includes(id))) {
        return current.filter((id) => !filteredIds.includes(id));
      }
      return Array.from(new Set([...current, ...filteredIds]));
    });
  }

  function applyVisionResultToAttachment(
    attachment: ImageAttachment,
    result: ImageVisionResult,
    status: ImageAttachment["analysis_status"]
  ): ImageAttachment {
    return {
      ...attachment,
      image_type: result.image_type,
      summary_80: result.summary_80 || "画像を添付しました。",
      image_tags: result.image_tags,
      visible_text: result.visible_text,
      confidence: result.confidence,
      analysis_status: status,
      error: status === "failed" ? result.error || "vision_failed" : undefined,
    };
  }

  async function saveRecordWithAttachments(record: CGMPRecord, attachments: ImageAttachment[]) {
    const nextRecord: CGMPRecord = {
      ...record,
      attachments,
      updated_at: new Date().toISOString(),
    };
    const saved = await upsertRecord(nextRecord);
    void assignSemanticIcon(saved, true);
    await reloadRecords(nextRecord.id);
    await reloadBackupSummary();
    window.setTimeout(() => {
      void runBackupQueue(false);
    }, 0);
    return nextRecord;
  }

  async function patchAttachment(
    recordId: string,
    attachmentId: string,
    patcher: (attachment: ImageAttachment) => ImageAttachment
  ) {
    const latestRecords = await loadAllRecords();
    const record = latestRecords.find((item) => item.id === recordId);
    if (!record) return null;
    const attachments = (record.attachments || []).map((attachment) =>
      attachment.id === attachmentId ? patcher(attachment) : attachment
    );
    return saveRecordWithAttachments(record, attachments);
  }

  async function analyzeAndUpdateAttachment(recordId: string, attachmentId: string, previewBlob: Blob) {
    const startedAt = performance.now();
    try {
      console.debug("[cgmp:image] reanalyze started", { recordId, attachmentId, size: previewBlob.size });
      const result = await analyzeImageWithVision(previewBlob);
      await patchAttachment(recordId, attachmentId, (attachment) => applyVisionResultToAttachment(attachment, result, "done"));
      console.debug("[cgmp:image] reanalyze completed", {
        recordId,
        attachmentId,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const fallback = fallbackImageAnalysis(error);
      await patchAttachment(recordId, attachmentId, (attachment) => applyVisionResultToAttachment(attachment, fallback, "failed"));
      console.debug("[cgmp:image] reanalyze failed", {
        recordId,
        attachmentId,
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
      });
    }
  }

  async function handleAddPhotos(recordId: string, files: File[]) {
    const targetRecord = records.find((record) => record.id === recordId);
    if (!targetRecord || files.length === 0) return;

    const processingId = beginAiProcessing("image", files.length > 1 ? `画像AI解析中（${files.length}枚）` : "画像AI解析中");
    setPhotoProcessingCount((count) => count + files.length);
    try {
      for (const file of files) {
        try {
          const prepared = await createImageAttachmentFromFile(recordId, file, { createThumbnail: true });
          await putImageBlob(prepared.attachment.previewBlobKey, prepared.previewBlob);
          if (prepared.thumbnailBlob && prepared.attachment.thumbnailBlobKey) {
            await putImageBlob(prepared.attachment.thumbnailBlobKey, prepared.thumbnailBlob);
          }

          const shouldAnalyze = typeof navigator === "undefined" ? true : navigator.onLine;
          const initialAttachment: ImageAttachment = {
            ...prepared.attachment,
            analysis_status: shouldAnalyze ? "analyzing" : "pending",
          };
          const latestRecords = await loadAllRecords();
          const latestRecord = latestRecords.find((record) => record.id === recordId) || targetRecord;
          await saveRecordWithAttachments(latestRecord, [...(latestRecord.attachments || []), initialAttachment]);
          console.debug("[cgmp:image] attachment saved", {
            recordId,
            attachmentId: initialAttachment.id,
            status: initialAttachment.analysis_status,
          });

          if (shouldAnalyze) {
            await analyzeAndUpdateAttachment(recordId, initialAttachment.id, prepared.previewBlob);
          }
        } catch (error) {
          console.debug("[cgmp:image] photo add failed", { recordId, fileName: file.name, error });
          setNotice({
            kind: "error",
            text: error instanceof Error ? `写真追加に失敗しました: ${error.message}` : "写真追加に失敗しました",
          });
        } finally {
          setPhotoProcessingCount((count) => Math.max(0, count - 1));
        }
      }
    } finally {
      finishAiProcessing(processingId);
    }
  }

  async function handleReanalyzeAttachment(recordId: string, attachmentId: string) {
    const record = records.find((item) => item.id === recordId);
    const attachment = record?.attachments?.find((item) => item.id === attachmentId);
    if (!attachment) return;

    const blob = await getImageBlob(attachment.previewBlobKey);
    if (!blob) {
      await patchAttachment(recordId, attachmentId, (current) => ({
        ...current,
        analysis_status: "failed",
        error: "PREVIEW_BLOB_NOT_FOUND",
      }));
      return;
    }

    const processingId = beginAiProcessing("image", "画像AI再解析中");
    try {
      await patchAttachment(recordId, attachmentId, (current) => ({
        ...current,
        analysis_status: "analyzing",
        error: undefined,
      }));
      await analyzeAndUpdateAttachment(recordId, attachmentId, blob);
    } finally {
      finishAiProcessing(processingId);
    }
  }

  async function handleDeleteAttachment(recordId: string, attachmentId: string) {
    const record = records.find((item) => item.id === recordId);
    const attachment = record?.attachments?.find((item) => item.id === attachmentId);
    if (!record || !attachment) return;
    const confirmed = window.confirm("この写真を削除しますか？");
    if (!confirmed) return;

    const blobKeys = [attachment.previewBlobKey, attachment.thumbnailBlobKey].filter(Boolean) as string[];
    await deleteImageBlobs(blobKeys);
    const attachments = (record.attachments || []).filter((item) => item.id !== attachmentId);
    await saveRecordWithAttachments(record, attachments);
    setNotice({ kind: "info", text: "写真を削除しました。" });
  }

  async function handleUpdateAttachmentMetadata(
    recordId: string,
    attachmentId: string,
    patch: Pick<ImageAttachment, "summary_80" | "image_tags" | "visible_text">
  ) {
    await patchAttachment(recordId, attachmentId, (attachment) => ({
      ...attachment,
      summary_80: String(patch.summary_80 || "").trim().slice(0, 120),
      image_tags: Array.from(
        new Set(
          (patch.image_tags || [])
            .map((tag) => String(tag || "").trim().replace(/^#+/, ""))
            .filter(Boolean)
            .map((tag) => tag.slice(0, 40))
        )
      ).slice(0, 5),
      visible_text: String(patch.visible_text || "").trim().slice(0, 180),
    }));
  }

  async function requestTextAnalysis(rawInput: string) {
    const controller = new AbortController();
    const timeoutMs = 45000;
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text: rawInput,
          input_at: new Date().toISOString(),
          model: settingsDraft?.openai_model || "gpt-4.1-nano",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<CGMPAnalysisResponse> & { detail?: string };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || payload.detail || "AI解析に失敗しました");
      }

      return payload as CGMPAnalysisResponse;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`AI解析がタイムアウトしました（${timeoutMs / 1000}秒）`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function saveComposeDraft(reason = "") {
    const rawInput = composeDraft.raw_input.trim();
    if (!rawInput) {
      setNotice({ kind: "error", text: "下書きにする入力テキストがありません。" });
      return null;
    }

    const stamp = new Date().toISOString();
    const draftForm = {
      ...blankForm(rawInput),
      title: getDraftRecordTitle(rawInput),
      summary: rawInput.slice(0, 120),
      body: rawInput,
    };
    const draftRecord: CGMPRecord = {
      ...formToRecord(draftForm, {
        aiStatus: "pending_ai",
        aiError: reason,
        aiMeta: null,
        backupStatus: "local_only",
      }),
      created_at: stamp,
      updated_at: stamp,
      date: "",
      time: "",
      all_day: false,
      external_action_status: "none",
      external_target: "",
      external_registered_at: "",
      external_error: "",
      google_task_id: "",
      google_task_list_id: "",
      google_task_status: "",
      google_task_updated_at: "",
      google_calendar_event_id: "",
      google_calendar_id: "",
      google_calendar_updated_at: "",
      backup_status: "local_only",
      backup_retry_count: 0,
      backup_last_error: "",
      backup_next_retry_at: "",
      drive_file_id: "",
      last_backup_at: "",
      backup_checksum: "",
      attachments: [],
    };

    const saved = await putRecordWithoutBackup(draftRecord);
    await Promise.all([reloadRecords(saved.id), reloadBackupSummary()]);
    setComposeDraft(blankForm(""));
    setComposeAiStatus("none");
    setComposeAiError("");
    setComposeAiMeta(null);
    setTab("home");
    setNotice({
      kind: "info",
      text: reason ? "AI解析に失敗したため、下書きとして保存しました。" : "下書きとして保存しました。",
    });
    return saved;
  }

  async function handleAnalyze() {
    const rawInput = composeDraft.raw_input.trim();
    if (!rawInput) {
      setNotice({ kind: "error", text: "入力テキストを入れてください。" });
      return;
    }

    setComposeLoading(true);
    setComposeAiError("");
    const processingId = beginAiProcessing("text", "テキストAI解析中");
    try {
      const payload = await requestTextAnalysis(rawInput);
      const analysis = payload.result;
      setComposeDraft((prev) => applyAnalysisToDraft(prev, rawInput, analysis));
      setComposeAiStatus("done");
      setComposeAiMeta({ model: payload.model || settingsDraft?.openai_model || "gpt-4.1-nano", generated_at: payload.generated_at });
      setNotice({ kind: "info", text: "AI解析が完了しました。" });
      window.setTimeout(() => {
        confirmSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (error) {
      setComposeAiStatus("error");
      const message = error instanceof Error ? error.message : "AI解析に失敗しました";
      setComposeAiError(message);
      setNotice({ kind: "error", text: message });
      try {
        await saveComposeDraft(message);
      } catch (draftError) {
        setNotice({
          kind: "error",
          text: `AI解析に失敗し、下書き保存にも失敗しました: ${
            draftError instanceof Error ? draftError.message : String(draftError)
          }`,
        });
      }
    } finally {
      finishAiProcessing(processingId);
      setComposeLoading(false);
    }
  }

  async function analyzeRecordWithAI(recordId: string) {
    if (externalProcessingKey) return;
    const latestRecords = await loadAllRecords();
    const targetRecord = latestRecords.find((record) => record.id === recordId);
    if (!targetRecord) {
      setNotice({ kind: "error", text: "メモが見つかりません。" });
      return;
    }
    const isDraftRecord = targetRecord.ai_status === "pending_ai";
    const rawInput = targetRecord.raw_input.trim();
    if (!rawInput) {
      setNotice({ kind: "error", text: "Raw inputが空です。" });
      return;
    }

    const externalChoice = isDraftRecord ? "keep" : await askReanalysisExternalChoice(targetRecord);
    if (externalChoice === "cancel") return;

    setExternalProcessingKey(`draft-ai:${recordId}`);
    const processingId = beginAiProcessing("text", isDraftRecord ? "下書きAI解析中" : "メモAI再解析中");
    try {
      const payload = await requestTextAnalysis(rawInput);
      const analyzedForm = applyAnalysisToDraft(formFromRecord(targetRecord), rawInput, payload.result);
      let nextRecord = formToRecord(analyzedForm, {
        existing: targetRecord,
        aiStatus: "done",
        aiError: "",
        aiMeta: {
          model: payload.model || settingsDraft?.openai_model || "gpt-4.1-nano",
          generated_at: payload.generated_at || new Date().toISOString(),
        },
        backupStatus: "pending_backup",
      });

      let externalDeleteErrors: string[] = [];
      if (externalChoice === "rebuild") {
        externalDeleteErrors = await deleteRegisteredExternalItems(targetRecord);
        nextRecord = clearExternalRegistrationFields(nextRecord, externalDeleteErrors.join(" / "));
      }

      let savedRecord = await upsertRecord({
        ...nextRecord,
        backup_retry_count: 0,
        backup_last_error: "",
        backup_next_retry_at: "",
      });
      await Promise.all([reloadRecords(savedRecord.id), reloadBackupSummary()]);

      const canRecreateExternal = externalChoice === "rebuild" && externalDeleteErrors.length === 0;
      if (canRecreateExternal && savedRecord.action === "reminder") {
        savedRecord = await registerGoogleTaskRecord(savedRecord, { backupAfterSave: false, showNotice: false });
      } else if (canRecreateExternal && savedRecord.action === "calendar") {
        savedRecord = await registerGoogleCalendarRecord(savedRecord, { backupAfterSave: false, showNotice: false });
      }

      await runSingleRecordBackup(savedRecord.id);
      setNotice({
        kind: externalDeleteErrors.length > 0 ? "error" : "info",
        text:
          externalDeleteErrors.length > 0
            ? `AI再解析後のDrive上書きは完了しましたが、Google側の削除に失敗しました: ${externalDeleteErrors.join(" / ")}`
            : externalChoice === "rebuild"
              ? "AI再解析とGoogle Driveへの上書き同期が完了しました。"
              : isDraftRecord
                ? "下書きをAI解析して通常メモにしました。Google Driveへ同期しました。"
                : "メモをAI再解析してGoogle Driveへ上書きしました。",
      });
      const alreadyRegistered = Boolean(getRegisteredExternalLabel(savedRecord));
      if (externalChoice !== "rebuild" && !alreadyRegistered && savedRecord.action === "reminder") {
        setExternalConfirm({ recordId: savedRecord.id, action: "reminder", title: savedRecord.title || "（無題）" });
      } else if (externalChoice !== "rebuild" && !alreadyRegistered && savedRecord.action === "calendar") {
        setExternalConfirm({ recordId: savedRecord.id, action: "calendar", title: savedRecord.title || "（無題）" });
      }
      void suggestRelatedRecords(savedRecord);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI解析に失敗しました";
      if (isDraftRecord) {
        const failedDraft = await putRecordWithoutBackup({
          ...targetRecord,
          ai_status: "pending_ai",
          ai_error: message,
          backup_status: "local_only",
          updated_at: targetRecord.updated_at,
        });
        setRecords((current) => current.map((record) => (record.id === failedDraft.id ? failedDraft : record)));
        setNotice({ kind: "error", text: `下書きのAI解析に失敗しました: ${message}` });
      } else {
        const failedRecord = await upsertRecord({
          ...targetRecord,
          ai_status: "error",
          ai_error: message,
          backup_status: targetRecord.backup_status === "local_only" ? "local_only" : "pending_backup",
          backup_last_error: "",
          backup_next_retry_at: "",
          updated_at: targetRecord.updated_at,
        });
        setRecords((current) => current.map((record) => (record.id === failedRecord.id ? failedRecord : record)));
        setNotice({ kind: "error", text: `メモのAI再解析に失敗しました: ${message}` });
      }
    } finally {
      finishAiProcessing(processingId);
      setExternalProcessingKey("");
    }
  }

  async function saveCompose(forceManual = false) {
    const nextRecord = formToRecord(composeDraft, {
      aiStatus: forceManual ? "none" : composeAiStatus,
      aiError: forceManual ? "" : composeAiError,
      aiMeta: forceManual ? null : composeAiMeta,
    });

    try {
      const savedRecord = await upsertRecord(nextRecord);
      void suggestRelatedRecords(savedRecord);
      await reloadRecords(savedRecord.id);
      await reloadBackupSummary();
      setNotice({ kind: "info", text: "保存しました。" });
      if (savedRecord.action === "reminder") {
        setExternalConfirm({ recordId: savedRecord.id, action: "reminder", title: savedRecord.title || "（無題）" });
      } else if (savedRecord.action === "calendar") {
        setExternalConfirm({ recordId: savedRecord.id, action: "calendar", title: savedRecord.title || "（無題）" });
      }
      window.setTimeout(() => {
        void runBackupQueue(false);
      }, 0);
      setComposeDraft(blankForm(""));
      setComposeAiStatus("none");
      setComposeAiError("");
      setComposeAiMeta(null);
      setTab("home");
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "保存に失敗しました",
      });
    }
  }

  function openEditPanel(id: string) {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    setSelectedId(id);
    setDetailDraft(formFromRecord(record));
    setIsEditPanelOpen(true);
  }

  async function saveDetail(closePanel = false) {
    if (!selectedRecord || !detailDraft) return;
    setDetailSaving(true);
    try {
      const nextRecord = formToRecord(detailDraft, { existing: selectedRecord });
      const savedRecord = await upsertRecord(nextRecord);
      const syncedRecord = await updateRegisteredExternalItems(savedRecord);
      await reloadRecords(syncedRecord.id);
      await reloadBackupSummary();
      void createOrRefreshEmbedding(syncedRecord).catch((error) => {
        console.debug("[cgmp:embedding] detail embedding refresh failed", {
          record_id: syncedRecord.id,
          error,
        });
      });
      void assignSemanticIcon(syncedRecord, true);
      setNotice({
        kind: syncedRecord.external_action_status === "failed" ? "error" : "info",
        text: syncedRecord.external_action_status === "failed" ? "更新しましたがGoogle側の更新に失敗しました。" : "更新しました。",
      });
      window.setTimeout(() => {
        void runBackupQueue(false);
      }, 0);
      setReloadTick((value) => value + 1);
      if (closePanel) {
        setIsEditPanelOpen(false);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "更新に失敗しました",
      });
    } finally {
      setDetailSaving(false);
    }
  }

  async function deleteRecordById(id: string) {
    const targetRecord = records.find((record) => record.id === id);
    if (!targetRecord) return;
    const confirmed = window.confirm(`「${targetRecord.title || "（無題）"}」を削除しますか？`);
    if (!confirmed) return;

    setDetailDeleting(true);
    try {
      const externalErrors = await deleteRegisteredExternalItems(targetRecord);
      await createDeletionTombstone(targetRecord, externalErrors);
      await reloadRecords();
      await reloadBackupSummary();
      await reloadDeletedRecordsSummary();
      setIsEditPanelOpen(false);
      setSelectedId((current) => {
        const remaining = records.filter((record) => record.id !== targetRecord.id);
        return remaining.find((record) => record.id === current)?.id ?? remaining[0]?.id ?? null;
      });
      setNotice({
        kind: externalErrors.length > 0 ? "error" : "info",
        text:
          externalErrors.length > 0
            ? `削除しました。Google側削除は失敗: ${externalErrors.join(" / ")}`
            : "削除しました。Driveにも削除済み情報を同期しました。",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "削除に失敗しました",
      });
    } finally {
      setDetailDeleting(false);
    }
  }

  async function deleteSelected() {
    if (!selectedRecord) return;
    await deleteRecordById(selectedRecord.id);
  }

  async function deleteCheckedRecords() {
    if (checkedRecordIds.length === 0) return;
    const confirmed = window.confirm(`選択した${checkedRecordIds.length}件のメモを削除しますか？ この操作は戻せません。`);
    if (!confirmed) return;

    try {
      const targets = records.filter((record) => checkedRecordIds.includes(record.id));
      const deleteResults = await Promise.all(
        targets.map(async (record) => ({
          record,
          externalErrors: await deleteRegisteredExternalItems(record),
        }))
      );
      await Promise.all(deleteResults.map(({ record, externalErrors }) => createDeletionTombstone(record, externalErrors)));
      const externalErrors = deleteResults.flatMap((result) => result.externalErrors);
      const deletedIds = new Set(targets.map((record) => record.id));
      setCheckedRecordIds([]);
      setIsEditPanelOpen((open) => (selectedId && deletedIds.has(selectedId) ? false : open));
      setSelectedId((current) => (current && deletedIds.has(current) ? null : current));
      await reloadRecords();
      await reloadBackupSummary();
      await reloadDeletedRecordsSummary();
      setNotice({
        kind: externalErrors.length > 0 ? "error" : "info",
        text:
          externalErrors.length > 0
            ? `選択${deletedIds.size}件をローカル削除しました。Google側削除の失敗があります。`
            : `選択した${deletedIds.size}件を削除しました。`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "選択削除に失敗しました",
      });
    }
  }

  async function handleSaveSettings() {
    if (!settingsDraft) return;
    setSettingsSaving(true);
    try {
      const next = await saveSettings(settingsDraft);
      setSettingsDraft(next);
      setNotice({ kind: "info", text: "設定を保存しました。" });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "設定保存に失敗しました",
      });
    } finally {
      setSettingsSaving(false);
    }
  }

  async function runShortcutWebhookTest() {
    const text = webhookTestText.trim();
    if (!text) {
      setNotice({ kind: "error", text: "Webhookテスト用のテキストを入力してください。" });
      return;
    }

    const startedAt = performance.now();
    setWebhookTestStartedAt(startedAt);
    setWebhookTestElapsedMs(0);
    setWebhookTestReport(null);
    setWebhookTestRunning(true);
    setIsWebhookTestModalOpen(true);

    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      const token = webhookTestToken.trim();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/shortcut-webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          source: "cgmp_settings_test",
          timezone: settingsDraft?.timezone || "Asia/Tokyo",
          clientRequestId: `settings_test_${Date.now()}`,
          debug: true,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ShortcutWebhookTestReport;
      setWebhookTestReport(payload);
      console.info("[cgmp:webhook-test] report", payload);
      if (!response.ok || !payload.ok) {
        setNotice({
          kind: "error",
          text: payload.error || payload.errorCode || payload.message || "Webhookテストで失敗しました。",
        });
      }
      await reloadRecords(payload.recordId);
      await reloadBackupSummary();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhookテストに失敗しました";
      const fallback: ShortcutWebhookTestReport = {
        ok: false,
        message: "Webhookテストに失敗しました",
        error: message,
        confirmationText: "テストに失敗しました。通信状態またはWebhook設定を確認してください。",
      };
      setWebhookTestReport(fallback);
      console.error("[cgmp:webhook-test] failed", error);
      setNotice({ kind: "error", text: message });
    } finally {
      setWebhookTestElapsedMs(Math.round(performance.now() - startedAt));
      setWebhookTestRunning(false);
    }
  }

  async function loadPromptConfigForEditor() {
    setPromptConfigLoading(true);
    setPromptConfigError("");
    try {
      const response = await fetch("/api/prompts");
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        source?: string;
        error?: string;
        definitions?: PromptEditorDefinition[];
        config?: CGMPPromptConfigFile;
      };
      if (!response.ok || !payload.config || !payload.definitions) {
        throw new Error(payload.error || "PROMPT_CONFIG_LOAD_FAILED");
      }
      setPromptDefinitions(payload.definitions);
      setPromptConfigDraft(payload.config);
      setActivePromptKey(payload.definitions[0]?.key || "action");
      setPromptConfigError(payload.error || "");
    } catch (error) {
      setPromptConfigError(error instanceof Error ? error.message : "プロンプト設定の読み込みに失敗しました");
    } finally {
      setPromptConfigLoading(false);
    }
  }

  function openPromptEditor() {
    setIsPromptEditorOpen(true);
    if (!promptConfigDraft && !promptConfigLoading) {
      void loadPromptConfigForEditor();
    }
  }

  function updatePromptDraft(key: CGMPPromptKey, userPrompt: string) {
    setPromptConfigDraft((current) => {
      if (!current) return current;
      const now = new Date().toISOString();
      return {
        ...current,
        updated_at: now,
        prompts: {
          ...current.prompts,
          [key]: {
            key,
            userPrompt,
            updated_at: now,
          },
        },
      };
    });
  }

  function resetActivePromptToDefault() {
    const definition = promptDefinitions.find((item) => item.key === activePromptKey);
    if (!definition) return;
    updatePromptDraft(activePromptKey, definition.defaultUserPrompt);
  }

  async function savePromptConfig() {
    if (!promptConfigDraft) return;
    setPromptConfigSaving(true);
    setPromptConfigError("");
    try {
      const response = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: promptConfigDraft }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        definitions?: PromptEditorDefinition[];
        config?: CGMPPromptConfigFile;
      };
      if (!response.ok || !payload.ok || !payload.config) {
        throw new Error(payload.error || "PROMPT_CONFIG_SAVE_FAILED");
      }
      setPromptConfigDraft(payload.config);
      if (payload.definitions) setPromptDefinitions(payload.definitions);
      setNotice({ kind: "info", text: "AIプロンプトをGoogle Driveへ保存しました。" });
    } catch (error) {
      setPromptConfigError(error instanceof Error ? error.message : "AIプロンプト保存に失敗しました");
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "AIプロンプト保存に失敗しました",
      });
    } finally {
      setPromptConfigSaving(false);
    }
  }

  async function handleClearAll() {
    const confirmed = window.confirm("全ての記録を削除しますか？ この操作は戻せません。");
    if (!confirmed) return;
    await clearAllRecords();
    await reloadRecords();
    await reloadBackupSummary();
    setSelectedId(null);
    setNotice({ kind: "info", text: "全件削除しました。" });
  }

  function handleHardReloadApp() {
    const url = new URL(window.location.href);
    url.searchParams.set("reload", Date.now().toString());
    window.location.replace(url.toString());
  }

  async function handleScriptableImportFile(file: File | undefined) {
    if (!file) return;
    setScriptableImporting(true);
    setScriptableImportResult(null);
    try {
      const result = await importScriptableCgmpZip(file);
      setScriptableImportResult(result);
      await Promise.all([reloadRecords(), reloadBackupSummary()]);
      setNotice({
        kind: result.errors.length > 0 ? "error" : "info",
        text: `Scriptable移行: 追加${result.imported}件 / 上書き${result.overwritten}件 / 画像${result.imagesImported}枚`,
      });
      window.setTimeout(() => {
        void runBackupQueue(false);
      }, 0);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Scriptableデータのインポートに失敗しました",
      });
    } finally {
      setScriptableImporting(false);
    }
  }

  if (!isReady) {
    return (
      <main className="min-h-screen bg-[image:var(--app-bg)] px-6 py-10 text-[var(--text)]">
        <div className="mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center">
          <div className={panelClass}>
            <p className="text-sm uppercase tracking-[0.4em] text-[var(--accent)]">CGMP PWA</p>
            <h1 className="mt-3 text-3xl font-semibold text-[var(--text)]">読み込み中...</h1>
            <p className="mt-2 text-[var(--muted)]">IndexedDB と設定を確認しています。</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[var(--bg)] bg-[image:var(--app-bg)] text-[var(--text)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col overflow-x-hidden px-2 py-3 pb-28 sm:px-5 lg:px-7">
        {notice ? (
          <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[110] flex justify-center px-3 sm:justify-end sm:px-5">
            <div
              className={`pointer-events-auto flex max-w-[min(34rem,calc(100vw-1.5rem))] items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_50px_var(--shadow-soft)] backdrop-blur-xl ${
                notice.kind === "info"
                  ? "border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--card)_88%,var(--accent-soft))] text-[var(--text)]"
                  : "border-[color:var(--danger)] bg-[color-mix(in_srgb,var(--card)_86%,var(--danger-soft))] text-[var(--text)]"
              }`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  notice.kind === "info"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "bg-[var(--danger-soft)] text-[var(--danger)]"
                }`}
                aria-hidden="true"
              >
                {notice.kind === "info" ? "✓" : "!"}
              </span>
              <p className="min-w-0 flex-1 leading-6">{notice.text}</p>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="rounded-full px-1.5 text-base leading-5 text-[var(--muted)] transition hover:bg-[var(--card-soft)] hover:text-[var(--text)]"
                aria-label="通知を閉じる"
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        {syncActivity ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.65rem+env(safe-area-inset-bottom))] z-[70] flex justify-start px-3 sm:bottom-[calc(5.9rem+env(safe-area-inset-bottom))] sm:px-5">
            <div
              className={`flex max-w-[min(30rem,calc(100vw-7rem))] items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-[0_16px_42px_var(--shadow-soft)] backdrop-blur-xl transition ${
                syncActivity.status === "error"
                  ? "border-[color:var(--danger)] bg-[color-mix(in_srgb,var(--card)_82%,var(--danger-soft))] text-[var(--text)]"
                  : syncActivity.status === "done"
                    ? "border-[color:var(--success)] bg-[color-mix(in_srgb,var(--card)_82%,var(--success-soft))] text-[var(--text)]"
                    : "border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--card)_72%,transparent)] text-[var(--text)]"
              }`}
              role={syncActivity.status === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  syncActivity.status === "error"
                    ? "bg-[var(--danger)]"
                    : syncActivity.status === "done"
                      ? "bg-[var(--success)]"
                      : "animate-pulse bg-[var(--accent)]"
                }`}
                aria-hidden="true"
              />
              <span className="shrink-0 font-semibold">{syncActivity.label}</span>
              {syncActivity.title ? (
                <span className="min-w-0 truncate text-[var(--muted)]">“{syncActivity.title}”</span>
              ) : null}
              {syncActivity.detail ? <span className="shrink-0 text-[var(--subtle)]">{syncActivity.detail}</span> : null}
            </div>
          </div>
        ) : null}

        <PostSaveSuggestionsModal
          externalConfirm={externalConfirm}
          relatedCandidates={relatedCandidates}
          onConfirmExternalRegistration={confirmExternalRegistration}
          onDismissExternalConfirm={() => setExternalConfirm(null)}
          onDismissRelatedCandidates={() => setRelatedCandidates([])}
          onOpenRelatedRecord={(recordId) => {
            setRelatedCandidates([]);
            setSelectedId(recordId);
            setTab("home");
            window.setTimeout(() => {
              document.getElementById(`record-card-${recordId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 80);
          }}
        />

        {reanalysisExternalConfirm ? (
          <div className="fixed inset-0 z-[96] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
            <section className="w-full max-w-lg rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
              <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">AI Reanalysis</div>
              <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">Google側の登録を作り直しますか？</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                「{reanalysisExternalConfirm.title}」は {reanalysisExternalConfirm.externalLabel} に登録済みです。
                AI再解析で内容・日時・actionが変わる可能性があります。
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                「削除して作り直す」を選ぶと、再解析前のGoogle側データを削除し、再解析後の内容で再登録してからDriveへ上書きします。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => resolveReanalysisExternalChoice("rebuild")}
                  className={primaryButtonClass}
                >
                  削除して作り直す
                </button>
                <button
                  type="button"
                  onClick={() => resolveReanalysisExternalChoice("keep")}
                  className={secondaryButtonClass}
                >
                  Google側は触らず再解析
                </button>
                <button
                  type="button"
                  onClick={() => resolveReanalysisExternalChoice("cancel")}
                  className={secondaryButtonClass}
                >
                  キャンセル
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <ExternalSyncProgressModal
          progress={externalSyncProgress}
          onClose={() => setExternalSyncProgress(null)}
        />

        <BackupSyncProgressModal
          progress={backupSyncProgress}
          progressNow={backupProgressNow}
          onClose={() => setBackupSyncProgress(null)}
        />

        <WebhookTestModal
          open={isWebhookTestModalOpen}
          running={webhookTestRunning}
          report={webhookTestReport}
          elapsedMs={webhookTestElapsedMs}
          onClose={() => setIsWebhookTestModalOpen(false)}
        />

        <PromptSettingsModal
          open={isPromptEditorOpen}
          definitions={promptDefinitions}
          configDraft={promptConfigDraft}
          loading={promptConfigLoading}
          saving={promptConfigSaving}
          error={promptConfigError}
          activePromptKey={activePromptKey}
          onActivePromptKeyChange={setActivePromptKey}
          onClose={() => setIsPromptEditorOpen(false)}
          onReload={loadPromptConfigForEditor}
          onSave={savePromptConfig}
          onResetActivePromptToDefault={resetActivePromptToDefault}
          onUpdatePromptDraft={updatePromptDraft}
        />

        {tab === "home" ? (
          <HomeView
            records={filteredRecords}
            selectedId={selectedId}
            checkedRecordIds={checkedRecordIds}
            query={query}
            tagQuery={tagQuery}
            actionFilter={actionFilter}
            domainFilter={domainFilter}
            paraFilter={paraFilter}
            sortKey={sortKey}
            searchMode={searchMode}
            semanticStatusText={semanticStatusText}
            isFilterOpen={isFilterOpen}
            activeFilterCount={activeFilterCount}
            externalProcessingKey={externalProcessingKey}
            isPhotoProcessing={photoProcessingCount > 0}
            isBackupProcessing={backupProcessing}
            onQueryChange={setQuery}
            onTagQueryChange={setTagQuery}
            onActionFilterChange={setActionFilter}
            onDomainFilterChange={setDomainFilter}
            onParaFilterChange={setParaFilter}
            onSortKeyChange={setSortKey}
            onSearchModeChange={setSearchMode}
            onFilterOpenChange={setIsFilterOpen}
            onGoCompose={() => setTab("compose")}
            onClearFilters={() => {
              setQuery("");
              setTagQuery("");
              setActionFilter("all");
              setDomainFilter("all");
              setParaFilter("all");
              setSortKey("updated_at");
            }}
            onOpenRecord={(id) => setSelectedId((current) => (current === id ? null : id))}
            onEdit={openEditPanel}
            onDelete={deleteRecordById}
            onRegisterGoogleTask={registerGoogleTask}
            onToggleGoogleTaskStatus={toggleGoogleTaskStatus}
            onRegisterGoogleCalendarEvent={registerGoogleCalendarEvent}
            onOpenImage={(attachment, imageUrl) => setLightbox({ imageUrl, title: attachment.summary_80 || "添付画像" })}
            onReanalyzeAttachment={handleReanalyzeAttachment}
            onDeleteAttachment={handleDeleteAttachment}
            onAddPhotos={handleAddPhotos}
            onSyncOne={runSingleRecordBackup}
            onAnalyzeRecord={analyzeRecordWithAI}
            onShowBadgeInfo={setBadgeInfo}
            onToggleCheck={toggleCheckedRecord}
          />
        ) : null}

        {tab === "today" ? (
          <TodayView
            records={records}
            settings={settingsDraft}
            onOpenRecord={(id) => {
              setSelectedId(id);
              setTab("home");
              setPendingMiniJumpId(id);
            }}
            onOpenImage={(attachment, imageUrl) => setLightbox({ imageUrl, title: attachment.summary_80 || "添付画像" })}
            onToggleGoogleTaskStatus={toggleGoogleTaskStatus}
            externalProcessingKey={externalProcessingKey}
          />
        ) : null}

        {tab === "week" ? (
          <WeeklyView
            weekStart={weekStart}
            records={filteredRecords}
            onPreviousWeek={() => setWeekStart((current) => addDays(current, -7))}
            onNextWeek={() => setWeekStart((current) => addDays(current, 7))}
            onThisWeek={() => setWeekStart(getMondayOfWeek(new Date()))}
            onOpenRecord={(id) => {
              setSelectedId(id);
              setTab("home");
              setPendingMiniJumpId(id);
            }}
            onOpenImage={(attachment, imageUrl) => setLightbox({ imageUrl, title: attachment.summary_80 || "添付画像" })}
            onToggleGoogleTaskStatus={toggleGoogleTaskStatus}
            externalProcessingKey={externalProcessingKey}
          />
        ) : null}

        {tab === "compose" ? (
          <ComposeView
            draft={composeDraft}
            loading={composeLoading}
            aiStatus={composeAiStatus}
            aiError={composeAiError}
            aiMeta={composeAiMeta}
            rawInputRef={composeRawInputRef}
            confirmSectionRef={confirmSectionRef}
            onDraftChange={(patch) => setComposeDraft((prev) => ({ ...prev, ...patch }))}
            onAnalyze={handleAnalyze}
            onSave={() => saveCompose()}
            onSaveWithoutAi={() => saveCompose(true)}
            onSaveDraft={() => void saveComposeDraft()}
            onClear={() => {
              setComposeDraft(blankForm(""));
              setComposeAiStatus("none");
              setComposeAiError("");
              setComposeAiMeta(null);
            }}
            onGoHome={() => setTab("home")}
          />
        ) : null}

        {tab === "settings" ? (
          <SettingsView
            settingsDraft={settingsDraft}
            setSettingsDraft={setSettingsDraft}
            settingsSaving={settingsSaving}
            themeMode={themeMode}
            embeddingIndexStats={embeddingIndexStats}
            embeddingProgress={embeddingProgress}
            embeddingCancelRef={embeddingCancelRef}
            semanticIconDictionary={semanticIconDictionary}
            semanticIconIndexStats={semanticIconIndexStats}
            semanticIconProgress={semanticIconProgress}
            backupSummary={backupSummary}
            deletedRecordsSummary={deletedRecordsSummary}
            backupProcessing={backupProcessing}
            driveBackupLoading={driveBackupLoading}
            driveImporting={driveImporting}
            externalSyncing={externalSyncing}
            webhookTestText={webhookTestText}
            setWebhookTestText={setWebhookTestText}
            webhookTestToken={webhookTestToken}
            setWebhookTestToken={setWebhookTestToken}
            webhookTestRunning={webhookTestRunning}
            webhookTestReport={webhookTestReport}
            setIsWebhookTestModalOpen={setIsWebhookTestModalOpen}
            driveBackupRecords={driveBackupRecords}
            driveBackupCheckedAt={driveBackupCheckedAt}
            scriptableImportInputRef={scriptableImportInputRef}
            scriptableImporting={scriptableImporting}
            scriptableImportResult={scriptableImportResult}
            deployInfoLoading={deployInfoLoading}
            deployInfo={deployInfo}
            handleSaveSettings={handleSaveSettings}
            reloadSettings={reloadSettings}
            changeThemeMode={changeThemeMode}
            openPromptEditor={openPromptEditor}
            rebuildEmbeddingIndex={rebuildEmbeddingIndex}
            reloadEmbeddingIndexStats={reloadEmbeddingIndexStats}
            rebuildSemanticIconDictionaryIndex={rebuildSemanticIconDictionaryIndex}
            reassignSemanticIcons={reassignSemanticIcons}
            resetSemanticIconsToDefault={resetSemanticIconsToDefault}
            addSemanticIconEntry={addSemanticIconEntry}
            runBackupQueue={runBackupQueue}
            rebackupAllRecords={rebackupAllRecords}
            loadDriveBackupList={loadDriveBackupList}
            importMissingFromDrive={importMissingFromDrive}
            syncExternalStatuses={syncExternalStatuses}
            runShortcutWebhookTest={runShortcutWebhookTest}
            handleScriptableImportFile={handleScriptableImportFile}
            handleHardReloadApp={handleHardReloadApp}
            handleClearAll={handleClearAll}
          />
        ) : null}
      </div>

      <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex flex-col items-end gap-3 sm:right-[max(1.5rem,env(safe-area-inset-right))]">
        <button
          type="button"
          onClick={() => {
            setTab("compose");
            setComposeDraft(blankForm(""));
            setComposeAiStatus("none");
            setComposeAiError("");
            setComposeAiMeta(null);
            setComposeFocusTick((value) => value + 1);
          }}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--orange)] bg-[var(--orange)] text-2xl font-semibold text-white shadow-[0_24px_60px_var(--shadow-soft)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:brightness-95 sm:h-16 sm:w-16"
          aria-label="新規メモを作成"
          title="新規メモを作成"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => setIsMiniListOpen((value) => !value)}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--border)] bg-[var(--card)] text-[26px] font-semibold text-[var(--text)] shadow-[0_20px_48px_var(--shadow-soft)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[var(--accent-soft)] sm:h-16 sm:w-16"
          aria-label="縮小メモ一覧を開く"
          title="縮小メモ一覧"
        >
          {isMiniListOpen ? "×" : "☰"}
        </button>
      </div>

      {isEditPanelOpen && selectedRecord && detailDraft ? (
        <>
          <div
            className="fixed inset-0 z-[60] bg-slate-950/30 backdrop-blur-[2px]"
            onClick={() => setIsEditPanelOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[88vh] animate-[editSheetUp_300ms_cubic-bezier(0.22,1,0.36,1)] flex-col rounded-t-[30px] border-t border-[color:var(--border)] bg-[var(--card)] shadow-[0_-24px_80px_var(--shadow-soft)] sm:inset-x-auto sm:inset-y-0 sm:left-0 sm:h-full sm:max-h-none sm:w-[min(600px,48vw)] sm:animate-[editPanelIn_300ms_cubic-bezier(0.22,1,0.36,1)] sm:rounded-r-[32px] sm:rounded-tl-none sm:border-r sm:border-t-0 sm:shadow-[24px_0_80px_var(--shadow-soft)]">
            <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Edit</div>
                <h2 className="mt-1 truncate text-xl font-semibold text-[var(--text)]">
                  {selectedRecord.title || "（無題）"}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={selectedRecord.action === "calendar" ? "amber" : selectedRecord.action === "reminder" ? "rose" : "cyan"}
                    title="Actionの意味を表示"
                    onClick={() => setBadgeInfo(getActionInfo(selectedRecord.action))}
                  >
                    {selectedRecord.action}
                  </Badge>
                  <DomainBadge domain={selectedRecord.domain || "other"} onClick={() => setBadgeInfo(getDomainInfo(selectedRecord.domain || "other"))} />
                  <Badge title="PARAの意味を表示" onClick={() => setBadgeInfo(getParaInfo(getEffectivePara(selectedRecord)))}>
                    {getEffectivePara(selectedRecord)}
                  </Badge>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditPanelOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[var(--card)] text-xl text-[var(--muted)] transition hover:bg-[var(--card-soft)]"
                aria-label="編集パネルを閉じる"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-5 sm:px-6">
              <div className="space-y-5">
                <ImageUploader
                  processingCount={photoProcessingCount}
                  disabled={photoProcessingCount > 0}
                  onFilesSelected={(files) => handleAddPhotos(selectedRecord.id, files)}
                />
                {(selectedRecord.attachments || []).length > 0 ? (
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.28em] text-[var(--accent)]">Photos</div>
                    <ImageAttachmentGrid
                      attachments={selectedRecord.attachments}
                      onOpen={(attachment, imageUrl) => setLightbox({ imageUrl, title: attachment.summary_80 || "添付画像" })}
                      onReanalyze={(attachmentId) => handleReanalyzeAttachment(selectedRecord.id, attachmentId)}
                      onDelete={(attachmentId) => handleDeleteAttachment(selectedRecord.id, attachmentId)}
                      onUpdateMetadata={(attachmentId, patch) =>
                        handleUpdateAttachmentMetadata(selectedRecord.id, attachmentId, patch)
                      }
                    />
                  </div>
                ) : null}
                <RecordEditor
                  draft={detailDraft}
                  onChange={(patch) => setDetailDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                  showRawInput
                />
              </div>
            </div>

            <div className="border-t border-[color:var(--border)] bg-[var(--card)] px-5 py-4 backdrop-blur sm:px-6">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => saveDetail(true)} disabled={detailSaving} className={primaryButtonClass}>
                  {detailSaving ? "保存中..." : "保存して閉じる"}
                </button>
                <button type="button" onClick={() => saveDetail(false)} disabled={detailSaving} className={secondaryButtonClass}>
                  保存
                </button>
                <button type="button" onClick={() => setIsEditPanelOpen(false)} className={secondaryButtonClass}>
                  キャンセル
                </button>
                <button type="button" onClick={deleteSelected} disabled={detailDeleting} className={dangerButtonClass}>
                  {detailDeleting ? "削除中..." : "削除"}
                </button>
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {isMiniListOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px]"
            onClick={() => setIsMiniListOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,420px)] animate-[miniListIn_300ms_cubic-bezier(0.22,1,0.36,1)] flex-col border-l border-[color:var(--border)] bg-[var(--card)] shadow-[-24px_0_80px_var(--shadow-soft)]">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-5 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Mini List</div>
                <h2 className="mt-1 text-lg font-semibold text-[var(--text)]">縮小メモ一覧</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsMiniListOpen(false)}
                className={secondaryButtonClass}
              >
                閉じる
              </button>
            </div>

            <div className="border-b border-[color:var(--border)] px-5 py-4">
              <label className="block text-sm font-medium text-[var(--text)]">
                全文検索
                <input
                  value={miniListQuery}
                  onChange={(event) => setMiniListQuery(event.target.value)}
                  placeholder="タイトル / 要約 / タグ / 原文"
                  className={fieldClass}
                />
              </label>
              <div className="mt-3 text-xs text-[var(--subtle)]">
                {miniFilteredRecords.length} / {records.length}
              </div>
            </div>

            <div className="flex-1 overflow-auto px-4 py-4">
              <div className="space-y-3">
                {miniFilteredRecords.length > 0 ? (
                  miniFilteredRecords.map((record) => (
                    <MiniRecordCard
                      key={record.id}
                      record={record}
                      onOpen={(id) => {
                        setSelectedId(id);
                        setIsMiniListOpen(false);
                        setTab("home");
                        setPendingMiniJumpId(id);
                      }}
                    />
                  ))
                ) : (
                  <div className={softPanelClass}>
                    <p className="text-sm leading-6 text-slate-500">
                      条件に一致する記録がありません。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {checkedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-[24px] border border-[color:var(--border)] bg-[var(--card)] px-3 py-3 shadow-[0_18px_55px_var(--shadow-soft)] backdrop-blur-xl">
            <span className="px-2 text-sm font-semibold text-[var(--text)]">{checkedCount}件選択中</span>
            <button type="button" onClick={toggleAllFilteredRecords} className={secondaryButtonClass}>
              {allFilteredChecked ? "表示分を解除" : "全て選択"}
            </button>
            <button type="button" onClick={deleteCheckedRecords} className={dangerButtonClass}>
              選択削除
            </button>
            <button type="button" onClick={() => setCheckedRecordIds([])} className={secondaryButtonClass}>
              解除
            </button>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <ImageLightbox
          imageUrl={lightbox.imageUrl}
          title={lightbox.title}
          onClose={() => setLightbox(null)}
        />
      ) : null}

      <BadgeInfoModal info={badgeInfo} onClose={() => setBadgeInfo(null)} />

      <AiProcessingOverlay state={aiProcessingOverlay} elapsedMs={aiProcessingElapsedMs} />

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--border)] bg-[var(--card)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        <div className="mx-auto grid max-w-3xl grid-cols-5 gap-2">
          {[
            { key: "home", label: "Home" },
            { key: "today", label: "Today" },
            { key: "week", label: "Week" },
            { key: "compose", label: "Compose" },
            { key: "settings", label: "Settings" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key as AppTab)}
              className={`rounded-2xl px-2 py-3 text-xs font-medium transition sm:px-4 sm:text-sm ${
                tab === item.key
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_10px_24px_var(--shadow-soft)]"
                  : "bg-[var(--card-soft)] text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
