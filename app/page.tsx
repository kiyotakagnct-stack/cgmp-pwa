"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ImageAttachmentGrid } from "@/components/ImageAttachmentGrid";
import { ImageLightbox } from "@/components/ImageLightbox";
import { ImageUploader } from "@/components/ImageUploader";
import { deleteImageBlobs, getImageBlob, putImageBlob } from "@/lib/db/imageBlobStore";
import { analyzeImageWithVision, fallbackImageAnalysis } from "@/lib/image/analyzeImageWithVision";
import { createImageAttachmentFromFile } from "@/lib/image/createImageAttachment";
import {
  clearAllRecords,
  deleteRecord,
  loadAllRecords,
  loadDeletedRecords,
  loadEmbeddingIndex,
  isRecordDeleted,
  loadSettings,
  putRecordWithoutBackup,
  saveSettings,
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
  CGMPSemanticSearchResultMode,
} from "@/lib/cgmp/types";
import type { CGMPPromptConfigFile, CGMPPromptDefinition, CGMPPromptKey } from "@/lib/cgmp/prompt-config";
import {
  createId,
  formatJstDateTime,
  makePreviewTitle,
  normalizeAction,
  normalizeDomain,
  normalizePara,
  parseTags,
  tagsToHashtags,
} from "@/lib/cgmp/utils";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { ImageAttachment, ImageVisionResult } from "@/types/image";

type AppTab = "home" | "week" | "compose" | "settings";
type SortKey = "updated_at" | "created_at" | "datetime";
type SearchMode = "text" | "semantic";
type ThemeMode = "system" | "light" | "dark";
type Notice = { kind: "info" | "error"; text: string } | null;
type LightboxState = { imageUrl: string; title: string } | null;
type PromptEditorDefinition = Omit<CGMPPromptDefinition, "hiddenContract">;
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
type ExternalSyncReportItem = {
  recordId: string;
  title: string;
  ok: boolean;
  changed: boolean;
  elapsedMs: number;
  taskElapsedMs: number;
  calendarElapsedMs: number;
  applyElapsedMs: number;
  hasTask: boolean;
  hasCalendar: boolean;
  error: string;
};
type ExternalSyncProgressState = {
  phase: "preparing" | "checking" | "applying" | "done" | "error";
  total: number;
  checked: number;
  applied: number;
  changed: number;
  failed: number;
  message: string;
  currentTitle: string;
  startedAt: number;
  checkingElapsedMs: number;
  applyingElapsedMs: number;
  reloadElapsedMs: number;
  reportItems: ExternalSyncReportItem[];
  finishedAt?: number;
};
type BackupSyncReportItem = {
  recordId: string;
  title: string;
  ok: boolean;
  itemType: string;
  skipped: boolean;
  attachmentId: string;
  elapsedMs: number;
  blobElapsedMs: number;
  uploadElapsedMs: number;
  previewSizeBytes: number;
  thumbnailSizeBytes: number;
  error: string;
};
type BackupSyncProgressState = {
  phase: "processing" | "done" | "error";
  message: string;
  startedAt: number;
  finishedAt?: number;
  total: number;
  succeeded: number;
  failed: number;
  processElapsedMs: number;
  reloadElapsedMs: number;
  reportItems: BackupSyncReportItem[];
};
type ShortcutWebhookTraceStep = {
  id: string;
  label: string;
  status: "running" | "success" | "error" | "skipped";
  startedAt: number;
  endedAt?: number;
  elapsedMs?: number;
  detail?: string;
  error?: string;
};
type ShortcutWebhookDebugTrace = {
  enabled: true;
  totalElapsedMs: number;
  steps: ShortcutWebhookTraceStep[];
};
type ShortcutWebhookTestReport = {
  ok?: boolean;
  message?: string;
  action?: string;
  title?: string;
  summary?: string;
  recordId?: string;
  date?: string;
  time?: string;
  confirmationText?: string;
  errorCode?: string;
  error?: string;
  debugTrace?: ShortcutWebhookDebugTrace;
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
type DeletedRecordsSummary = {
  count: number;
  latestDeletedAt: string;
};
type ExternalConfirmState = {
  recordId: string;
  action: "reminder" | "calendar";
  title: string;
} | null;
type BadgeInfo = {
  title: string;
  label: string;
  description: string;
  examples?: string[];
} | null;

type RecordFormState = {
  raw_input: string;
  title: string;
  summary: string;
  body: string;
  tagsText: string;
  action: CGMPAction;
  para: CGMPPara;
  domain: CGMPDomain;
  date: string;
  time: string;
  all_day: boolean;
  duration_minutes: number;
  location: string;
  confirmation: string;
  note_tags: string;
  note_index_line: string;
  user_intent_summary: string;
};

const fieldClass =
  "mt-2 w-full rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[color:var(--subtle)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent-soft)]";
const textareaClass = `${fieldClass} min-h-[120px] resize-y`;
const panelClass =
  "min-w-0 overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[var(--card)] p-4 shadow-[0_18px_55px_var(--shadow-soft),0_2px_10px_var(--shadow-soft)] sm:rounded-[28px] sm:p-5";
const softPanelClass =
  "min-w-0 overflow-hidden rounded-[22px] border border-[color:var(--border)] bg-[var(--card-soft)] p-3 shadow-[0_10px_30px_var(--shadow-soft)] sm:rounded-[24px] sm:p-4";
const primaryButtonClass =
  "rounded-2xl border border-[color:var(--accent)] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] shadow-[0_10px_24px_var(--shadow-soft)] transition hover:brightness-95";
const secondaryButtonClass =
  "rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] shadow-[0_8px_18px_var(--shadow-soft)] transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)]";
const dangerButtonClass =
  "rounded-2xl border border-[color:var(--danger)] bg-[var(--danger-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--danger)] transition hover:brightness-95";
const THEME_STORAGE_KEY = "cgmp_theme";

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = mode;
}

function blankForm(text = ""): RecordFormState {
  return {
    raw_input: text,
    title: "",
    summary: "",
    body: text,
    tagsText: "",
    action: "note",
    para: "area",
    domain: "other",
    date: "",
    time: "",
    all_day: false,
    duration_minutes: 60,
    location: "",
    confirmation: "",
    note_tags: "",
    note_index_line: "",
    user_intent_summary: "",
  };
}

function formFromRecord(record: CGMPRecord): RecordFormState {
  return {
    raw_input: record.raw_input || "",
    title: record.title || "",
    summary: record.summary || "",
    body: record.body || "",
    tagsText: (record.tags || []).join(" "),
    action: record.action || "note",
    para: record.para || "area",
    domain: record.domain || "other",
    date: record.date || "",
    time: record.time || "",
    all_day: Boolean(record.all_day),
    duration_minutes: record.duration_minutes || 60,
    location: record.location || "",
    confirmation: record.confirmation || "",
    note_tags: record.note_tags || "",
    note_index_line: record.note_index_line || "",
    user_intent_summary: record.user_intent_summary || "",
  };
}

function formToRecord(
  form: RecordFormState,
  options: {
    existing?: CGMPRecord | null;
    aiStatus?: CGMPRecord["ai_status"];
    aiError?: string;
    aiMeta?: { model: string; generated_at: string } | null;
    backupStatus?: CGMPRecord["backup_status"];
  }
): CGMPRecord {
  const stamp = new Date().toISOString();
  const tags = parseTags(form.tagsText);
  const existing = options.existing ?? null;
  const aiMeta = options.aiMeta ?? null;
  const action = normalizeAction(form.action);
  const para = normalizePara(form.para);
  const domain = normalizeDomain(form.domain);

  return {
    schema_version: 1,
    id: existing?.id || createId(),
    created_at: existing?.created_at || stamp,
    updated_at: stamp,
    raw_input: form.raw_input,
    title: form.title.trim() || makePreviewTitle(form.raw_input),
    summary: form.summary.trim() || form.user_intent_summary.trim() || form.raw_input.slice(0, 120),
    body: form.body.trim() || form.raw_input,
    action,
    tags,
    para,
    domain,
    date: form.date.trim(),
    time: form.time.trim(),
    all_day: Boolean(form.all_day),
    duration_minutes: Number.isFinite(Number(form.duration_minutes)) ? Math.max(1, Math.round(Number(form.duration_minutes))) : 60,
    location: form.location.trim(),
    confirmation: form.confirmation.trim(),
    note_tags: form.note_tags.trim() || tagsToHashtags(tags).join(" "),
    note_index_line: form.note_index_line.trim(),
    user_intent_summary: form.user_intent_summary.trim(),
    ai_status: options.aiStatus ?? existing?.ai_status ?? "none",
    ai_error: options.aiError ?? existing?.ai_error ?? "",
    external_action_status: existing?.external_action_status ?? "none",
    external_target: existing?.external_target ?? "",
    external_registered_at: existing?.external_registered_at ?? "",
    external_error: existing?.external_error ?? "",
    google_task_id: existing?.google_task_id ?? "",
    google_task_list_id: existing?.google_task_list_id ?? "",
    google_task_status: existing?.google_task_status ?? "",
    google_task_updated_at: existing?.google_task_updated_at ?? "",
    google_calendar_event_id: existing?.google_calendar_event_id ?? "",
    google_calendar_id: existing?.google_calendar_id ?? "",
    google_calendar_updated_at: existing?.google_calendar_updated_at ?? "",
    backup_status: options.backupStatus ?? existing?.backup_status ?? "pending_backup",
    backup_retry_count: existing?.backup_retry_count ?? 0,
    backup_last_error: existing?.backup_last_error ?? "",
    backup_next_retry_at: existing?.backup_next_retry_at ?? "",
    drive_file_id: existing?.drive_file_id ?? "",
    last_backup_at: existing?.last_backup_at ?? "",
    backup_checksum: existing?.backup_checksum ?? "",
    attachments: existing?.attachments ?? [],
    ai: {
      model: aiMeta?.model ?? existing?.ai?.model ?? "",
      generated_at: aiMeta?.generated_at ?? existing?.ai?.generated_at ?? stamp,
      initial_title: aiMeta ? form.title.trim() || makePreviewTitle(form.raw_input) : existing?.ai?.initial_title ?? "",
      initial_tags: aiMeta ? tags : existing?.ai?.initial_tags ?? [],
      initial_date: aiMeta ? form.date.trim() : existing?.ai?.initial_date ?? "",
      initial_time: aiMeta ? form.time.trim() : existing?.ai?.initial_time ?? "",
      initial_action: aiMeta ? action : existing?.ai?.initial_action ?? "note",
      initial_para: aiMeta ? para : existing?.ai?.initial_para ?? "area",
      initial_domain: aiMeta ? domain : existing?.ai?.initial_domain ?? "other",
      initial_summary: aiMeta ? form.summary.trim() || form.user_intent_summary.trim() : existing?.ai?.initial_summary ?? "",
    },
  };
}

function getRecordText(record: CGMPRecord) {
  return [
    record.title,
    record.summary,
    record.body,
    record.raw_input,
    record.note_index_line,
    record.user_intent_summary,
    record.confirmation,
    record.location,
    record.date,
    record.time,
    record.action,
    record.para,
    record.domain,
    ...(record.tags || []),
    ...(record.attachments || []).flatMap((attachment) => [
      attachment.summary_80,
      attachment.visible_text,
      ...(attachment.image_tags || []),
    ]),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
}

function getMiniListText(record: CGMPRecord) {
  return [
    record.title,
    record.summary,
    record.raw_input,
    ...(record.tags || []),
    ...(record.attachments || []).flatMap((attachment) => [
      attachment.summary_80,
      attachment.visible_text,
      ...(attachment.image_tags || []),
    ]),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
}

function applyAnalysisToDraft(draft: RecordFormState, rawInput: string, analysis: CGMPAnalysis): RecordFormState {
  return {
    ...draft,
    raw_input: rawInput,
    title: analysis.title || makePreviewTitle(rawInput),
    summary: analysis.summary || analysis.user_intent_summary || "",
    body: analysis.body || rawInput,
    tagsText: (analysis.tags || []).join(" "),
    action: normalizeAction(analysis.action),
    para: normalizePara(analysis.para),
    domain: normalizeDomain(analysis.domain),
    date: analysis.date || "",
    time: analysis.time || "",
    all_day: Boolean(analysis.all_day),
    duration_minutes: Number(analysis.duration_minutes || 60),
    location: analysis.location || "",
    confirmation: analysis.confirmation || "",
    note_tags: analysis.note_tags || "",
    note_index_line: analysis.note_index_line || "",
    user_intent_summary: analysis.user_intent_summary || analysis.summary || "",
  };
}

function getDraftRecordTitle(rawInput: string) {
  return makePreviewTitle(rawInput) || "下書き";
}

function getDateSortValue(record: CGMPRecord) {
  const date = record.date || "";
  const time = record.time || "";
  const stamp = `${date}T${time || "00:00"}:00`;
  const parsed = new Date(stamp);
  const value = parsed.getTime();
  return Number.isFinite(value) ? value : new Date(record.updated_at || record.created_at).getTime();
}

function matchesQuery(record: CGMPRecord, query: string, tagQuery: string) {
  const text = query.trim().toLowerCase();
  const tag = tagQuery.trim().toLowerCase();

  const textOk =
    !text ||
    text
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => getRecordText(record).includes(token));

  const tagOk =
    !tag ||
    (record.tags || []).some((item) => String(item || "").toLowerCase().includes(tag));

  return textOk && tagOk;
}

function getEffectivePara(record: CGMPRecord) {
  const para = normalizePara(record.para);
  return para || "area";
}

function matchesMiniQuery(record: CGMPRecord, query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => getMiniListText(record).includes(token));
}

function getBackupLabel(record: CGMPRecord) {
  if (record.backup_status === "backed_up") return "同期済";
  if (record.backup_status === "backing_up") return "同期中";
  if (record.backup_status === "pending_backup") return "未同期";
  if (record.backup_status === "backup_failed") return "同期失敗";
  if (record.backup_status === "conflicted") return "競合";
  return "端末";
}

function getBackupTone(record: CGMPRecord): "slate" | "cyan" | "emerald" | "amber" | "rose" {
  if (record.backup_status === "backed_up") return "emerald";
  if (record.backup_status === "backing_up") return "cyan";
  if (record.backup_status === "pending_backup") return "amber";
  if (record.backup_status === "backup_failed" || record.backup_status === "conflicted") return "rose";
  return "slate";
}

function getPhotoBackupBadge(record: CGMPRecord): { label: string; tone: "slate" | "cyan" | "emerald" | "amber" | "rose" } | null {
  const attachments = record.attachments || [];
  if (attachments.length === 0) return null;
  const backedUp = attachments.filter((attachment) => attachment.backup_status === "backed_up").length;
  const backingUp = attachments.filter((attachment) => attachment.backup_status === "backing_up").length;
  const failed = attachments.filter(
    (attachment) => attachment.backup_status === "backup_failed" || attachment.backup_status === "conflicted"
  ).length;
  if (failed > 0) return { label: `写失敗 ${failed}/${attachments.length}`, tone: "rose" };
  if (backingUp > 0) return { label: `写同期 ${backedUp}/${attachments.length}`, tone: "cyan" };
  if (backedUp === attachments.length) return { label: `写済 ${backedUp}/${attachments.length}`, tone: "emerald" };
  return { label: `写未 ${backedUp}/${attachments.length}`, tone: "amber" };
}

function getActionLabel(action: CGMPAction) {
  if (action === "calendar") return "Cal";
  if (action === "reminder") return "Rem";
  if (action === "unclear") return "?";
  return "Note";
}

function getParaLabel(para: CGMPPara) {
  if (para === "project") return "P";
  if (para === "resource") return "R";
  if (para === "archive") return "Arc";
  return "Area";
}

function getDomainLabel(domain: CGMPDomain | string) {
  const labels: Record<string, string> = {
    work: "work",
    family: "fam",
    self: "self",
    health: "hlth",
    finance: "fin",
    learning: "learn",
    creation: "make",
    life_admin: "admin",
    other: "other",
  };
  return labels[domain || "other"] || String(domain || "other");
}

function getActionInfo(action: CGMPAction): NonNullable<BadgeInfo> {
  const info: Record<CGMPAction, NonNullable<BadgeInfo>> = {
    note: {
      title: "Action",
      label: "Note",
      description: "情報、気づき、メモ、ログとして残す記録です。Google Tasks/Calendar登録は基本しません。",
      examples: ["会議メモ", "調査ログ", "思いつき"],
    },
    reminder: {
      title: "Action",
      label: "Reminder / Todo",
      description: "やること・タスクです。必要に応じてGoogle Tasksへ登録し、完了/未完了を同期できます。",
      examples: ["資料を送る", "買い物する", "確認する"],
    },
    calendar: {
      title: "Action",
      label: "Calendar",
      description: "予定・スケジュールです。日時がある場合はGoogle Calendar登録の対象になります。",
      examples: ["打ち合わせ", "通院予約", "イベント"],
    },
    unclear: {
      title: "Action",
      label: "Unclear",
      description: "メモ、タスク、予定の判定が曖昧な記録です。後で確認して分類し直す想定です。",
    },
  };
  return info[action || "note"] || info.note;
}

function getParaInfo(para: CGMPPara): NonNullable<BadgeInfo> {
  const info: Record<Exclude<CGMPPara, "">, NonNullable<BadgeInfo>> = {
    project: {
      title: "PARA",
      label: "P = Project",
      description: "期限や成果物がある進行中の案件です。終わりがある仕事・家庭タスク・開発案件など。",
      examples: ["PWA実装", "引越し準備", "旅行計画"],
    },
    area: {
      title: "PARA",
      label: "Area",
      description: "継続的に管理する責任領域です。終わりが明確ではなく、生活や仕事の維持管理に近いもの。",
      examples: ["家族", "健康", "仕事管理"],
    },
    resource: {
      title: "PARA",
      label: "R = Resource",
      description: "後で参照したい知識・資料・アイデアです。すぐ実行するものではなく、検索で再利用する情報。",
      examples: ["仕様メモ", "調査資料", "学び"],
    },
    archive: {
      title: "PARA",
      label: "Arc = Archive",
      description: "完了済み、過去ログ、保存のみの記録です。AreaのAと混ざらないよう、このアプリではArc表記にしています。",
      examples: ["完了した案件", "過去の記録", "保存ログ"],
    },
  };
  return info[(para || "area") as Exclude<CGMPPara, "">] || info.area;
}

function getDomainInfo(domain: CGMPDomain | string): NonNullable<BadgeInfo> {
  const normalized = normalizeDomain(domain) || "other";
  const info: Record<Exclude<CGMPDomain, "">, NonNullable<BadgeInfo>> = {
    work: { title: "Domain", label: "work", description: "仕事・業務・顧客・職場に関する記録です。" },
    family: { title: "Domain", label: "family", description: "家族、子ども、家庭内の予定や相談に関する記録です。" },
    self: { title: "Domain", label: "self", description: "自分自身の体調、考え、習慣、個人管理に関する記録です。" },
    health: { title: "Domain", label: "health", description: "健康、医療、通院、体調管理に関する記録です。" },
    finance: { title: "Domain", label: "finance", description: "お金、支払い、家計、費用、請求に関する記録です。" },
    learning: { title: "Domain", label: "learning", description: "学習、読書、調査、勉強に関する記録です。" },
    creation: { title: "Domain", label: "creation", description: "制作、開発、設計、アイデアづくりに関する記録です。" },
    life_admin: { title: "Domain", label: "life_admin", description: "生活事務、手続き、買い物、予約、家の管理に関する記録です。" },
    other: { title: "Domain", label: "other", description: "どの領域にも強く当てはまらない、または未分類の記録です。" },
  };
  return info[normalized as Exclude<CGMPDomain, "">] || info.other;
}

function getBackupInfo(record: CGMPRecord): NonNullable<BadgeInfo> {
  return {
    title: "Sync",
    label: getBackupLabel(record),
    description: "このメモ本文・メタデータのGoogle Drive同期状態です。画像の同期状態は別バッジで表示します。",
    examples: [
      "同期済: Google Drive側にも保存済み",
      "未同期: まだアップロード待ち",
      "失敗: 次回再同期または手動同期が必要",
    ],
  };
}

function getPhotoBackupInfo(record: CGMPRecord): NonNullable<BadgeInfo> {
  const badge = getPhotoBackupBadge(record);
  return {
    title: "Photo Sync",
    label: badge?.label || "写真なし",
    description: "添付画像のGoogle Drive同期状態です。メモ本文とは別に、画像本体のアップロード状況を管理しています。",
    examples: ["写済: 画像同期済み", "写未: 未同期画像あり", "写失敗: 画像アップロードに失敗"],
  };
}

function getTaskInfo(record: CGMPRecord): NonNullable<BadgeInfo> {
  return {
    title: "Google Tasks",
    label: record.google_task_status === "completed" ? "Task完" : "Task未",
    description: "Google Tasks側の完了状態です。Task未は未完了、Task完は完了済みを表します。",
  };
}

function getCalendarInfo(): NonNullable<BadgeInfo> {
  return {
    title: "Google Calendar",
    label: "GCal",
    description: "Google Calendarへ登録済みの予定です。Calendar側の変更は同期時にCGMPへ反映されます。",
  };
}

const ACTION_SYMBOLS: Record<CGMPAction, string> = {
  note: "📝",
  reminder: "✅",
  calendar: "📅",
  unclear: "❓",
};

const DOMAIN_SYMBOLS: Record<Exclude<CGMPDomain, "">, string> = {
  work: "🏢",
  family: "👨‍👩‍👧‍👦",
  self: "🌱",
  health: "🩺",
  finance: "💰",
  learning: "📚",
  creation: "🎨",
  life_admin: "🧾",
  other: "📌",
};

const DOMAIN_FILTER_OPTIONS: Array<{ value: Exclude<CGMPDomain, "">; label: string }> = [
  { value: "work", label: "work" },
  { value: "family", label: "fam" },
  { value: "self", label: "self" },
  { value: "health", label: "hlth" },
  { value: "finance", label: "fin" },
  { value: "learning", label: "learn" },
  { value: "creation", label: "make" },
  { value: "life_admin", label: "admin" },
  { value: "other", label: "other" },
];

const WEEKDAY_LABELS = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
const WEEKDAY_MINI_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getMondayOfWeek(date: Date) {
  const base = startOfDay(date);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(base, diff);
}

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWeekDate(date: Date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function formatWeekRange(start: Date) {
  return `${formatWeekDate(start)} - ${formatWeekDate(addDays(start, 6))}`;
}

function getJstParts(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { dateKey: "", time: "" };
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function minutesFromTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getRecordTimeline(record: CGMPRecord) {
  if (record.date) {
    const hasTime = Boolean(record.time);
    return {
      dateKey: record.date,
      timeLabel: record.all_day ? "終日" : hasTime ? record.time.slice(0, 5) : "No time",
      sourceLabel: "scheduled" as const,
      sortValue: record.all_day ? -1 : hasTime ? minutesFromTime(record.time) : Number.POSITIVE_INFINITY - 1,
    };
  }

  const created = getJstParts(record.created_at || record.updated_at);
  return {
    dateKey: created.dateKey,
    timeLabel: created.time || "No time",
    sourceLabel: "created" as const,
    sortValue: created.time ? minutesFromTime(created.time) : Number.POSITIVE_INFINITY,
  };
}

function getActionSymbol(record: CGMPRecord) {
  if ((record.attachments || []).some((attachment) => attachment.type === "image")) return "🖼️";
  return ACTION_SYMBOLS[record.action || "note"] || ACTION_SYMBOLS.note;
}

function getDomainSymbol(domain: CGMPDomain | string) {
  const normalized = normalizeDomain(domain);
  return DOMAIN_SYMBOLS[(normalized || "other") as Exclude<CGMPDomain, "">] || DOMAIN_SYMBOLS.other;
}

function scrollToElementById(id: string, block: ScrollLogicalPosition = "start") {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block });
}

function normalizeSemanticThreshold(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return SEMANTIC_CANDIDATE_THRESHOLD;
  return Math.min(1, Math.max(-1, number));
}

function Badge({
  children,
  tone = "slate",
  compact = false,
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: "slate" | "cyan" | "emerald" | "amber" | "rose";
  compact?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const toneClass =
    tone === "cyan"
      ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
      : tone === "emerald"
        ? "border-[color:var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
        : tone === "amber"
          ? "border-[color:var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)]"
          : tone === "rose"
            ? "border-[color:var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
            : "border-[color:var(--border)] bg-[var(--card-soft)] text-[var(--muted)]";
  const className = `inline-flex items-center rounded-full border ${
    compact ? "px-2 py-0.5 text-[11px] leading-5" : "px-2.5 py-1 text-xs"
  } ${toneClass}`;
  if (onClick) {
    return (
      <button
        type="button"
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={`${className} cursor-help text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
      >
        {children}
      </button>
    );
  }
  return (
    <span
      title={title}
      className={className}
    >
      {children}
    </span>
  );
}

function getDomainColorVar(domain: CGMPDomain | string) {
  const normalized = String(domain || "other").replace("_", "-");
  if (normalized === "life-admin") return "var(--domain-life-admin)";
  return `var(--domain-${normalized})`;
}

function DomainBadge({
  domain,
  compact = false,
  onClick,
}: {
  domain: CGMPDomain | string;
  compact?: boolean;
  onClick?: () => void;
}) {
  const color = getDomainColorVar(domain);
  const className = `inline-flex items-center rounded-full border text-[color:var(--domain-color)] ${
    compact ? "px-2 py-0.5 text-[11px] leading-5" : "px-2.5 py-1 text-xs"
  }`;
  const style = {
    "--domain-color": color,
    backgroundColor: `color-mix(in srgb, ${color} 12%, var(--card))`,
    borderColor: color,
  } as CSSProperties;
  if (onClick) {
    return (
      <button
        type="button"
        title="Domainの意味を表示"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={`${className} cursor-help text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]`}
        style={style}
      >
        {getDomainLabel(domain)}
      </button>
    );
  }
  return (
    <span
      className={className}
      style={style}
    >
      {getDomainLabel(domain)}
    </span>
  );
}

function BadgeInfoModal({ info, onClose }: { info: BadgeInfo; onClose: () => void }) {
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/24 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center sm:pb-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="説明を閉じる" onClick={onClose} />
      <section className="relative w-full max-w-md rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_24px_80px_var(--shadow-soft)]">
        <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">{info.title}</div>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--text)]">{info.label}</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{info.description}</p>
        {info.examples?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {info.examples.map((example) => (
              <Badge key={example} compact>
                {example}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            閉じる
          </button>
        </div>
      </section>
    </div>
  );
}

function AiProcessingOverlay({
  state,
  elapsedMs,
}: {
  state: AiProcessingOverlayState | null;
  elapsedMs: number;
}) {
  if (!state) return null;

  const isDone = typeof state.finishedAt === "number";
  const title = isDone ? "完了しました" : state.label;
  const description = isDone
    ? `所要時間 ${elapsedMs.toLocaleString("ja-JP")} ms`
    : `${elapsedMs.toLocaleString("ja-JP")} ms`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--overlay)] px-6 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="w-full max-w-[280px] rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-6 text-center shadow-[0_24px_80px_var(--shadow-soft)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)]">
          {isDone ? (
            <span className="text-2xl font-bold text-[var(--accent)]">✓</span>
          ) : (
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
          )}
        </div>
        <div className="mt-4 text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
          {state.kind === "text" ? "Text AI" : "Image AI"}
        </div>
        <div className="mt-2 text-lg font-semibold text-[var(--text)]">{title}</div>
        <div className="mt-2 font-mono text-sm text-[var(--muted)]">{description}</div>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--accent)]">{eyebrow}</div>
      <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">{title}</h2>
      {description ? <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{description}</p> : null}
    </div>
  );
}

function SettingsAccordion({
  title,
  summary,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[var(--card-soft)] shadow-[0_10px_30px_var(--shadow-soft)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition hover:bg-[var(--accent-soft)]"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-[var(--text)]">{title}</span>
            {badge}
          </span>
          {summary ? <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">{summary}</span> : null}
        </span>
        <span className="mt-0.5 shrink-0 rounded-full border border-[color:var(--border)] bg-[var(--card)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">
          {open ? "閉じる" : "開く"}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-[color:var(--border)] px-4 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={fieldClass}
      />
    </label>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <input
        type="number"
        min={1}
        value={Number.isFinite(value) ? value : 60}
        onChange={(event) => onChange(Number(event.target.value || 60))}
        className={fieldClass}
      />
    </label>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 5,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        ref={inputRef}
        className={textareaClass}
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block min-w-0 text-sm font-medium text-[var(--text)]">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabeledToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--text)]">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full border transition ${
          value ? "border-[color:var(--accent)] bg-[var(--accent)]" : "border-[color:var(--border)] bg-[var(--card-soft)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
            value ? "left-5" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function RecordEditor({
  draft,
  onChange,
  showRawInput = false,
}: {
  draft: RecordFormState;
  onChange: (patch: Partial<RecordFormState>) => void;
  showRawInput?: boolean;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        {showRawInput ? (
          <LabeledTextarea
            label="Raw input"
            value={draft.raw_input}
            onChange={(value) => onChange({ raw_input: value, body: draft.body || value })}
            placeholder="雑に投げたメモ本文"
            rows={8}
          />
        ) : null}
        <LabeledInput label="Title" value={draft.title} onChange={(value) => onChange({ title: value })} placeholder="短く具体的に" />
        <LabeledTextarea
          label="Summary"
          value={draft.summary}
          onChange={(value) => onChange({ summary: value })}
          placeholder="要点を1〜2行で"
          rows={4}
        />
        <LabeledTextarea label="Body" value={draft.body} onChange={(value) => onChange({ body: value })} placeholder="本文" rows={8} />
        <LabeledInput
          label="Tags"
          value={draft.tagsText}
          onChange={(value) => onChange({ tagsText: value })}
          placeholder="#仕事 #AI #仕様"
        />
      </div>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledSelect
            label="Action"
            value={draft.action}
            onChange={(value) => onChange({ action: normalizeAction(value) })}
            options={[
              { value: "note", label: "note" },
              { value: "reminder", label: "reminder" },
              { value: "calendar", label: "calendar" },
              { value: "unclear", label: "unclear" },
            ]}
          />
          <LabeledSelect
            label="PARA"
            value={draft.para}
            onChange={(value) => onChange({ para: normalizePara(value) })}
            options={[
              { value: "project", label: "project" },
              { value: "area", label: "area" },
              { value: "resource", label: "resource" },
              { value: "archive", label: "archive" },
            ]}
          />
          <LabeledSelect
            label="Domain"
            value={draft.domain}
            onChange={(value) => onChange({ domain: normalizeDomain(value) })}
            options={[
              { value: "work", label: "work" },
              { value: "family", label: "family" },
              { value: "self", label: "self" },
              { value: "health", label: "health" },
              { value: "finance", label: "finance" },
              { value: "learning", label: "learning" },
              { value: "creation", label: "creation" },
              { value: "life_admin", label: "life_admin" },
              { value: "other", label: "other" },
            ]}
          />
          <LabeledNumber
            label="Duration (min)"
            value={draft.duration_minutes}
            onChange={(value) => onChange({ duration_minutes: value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledInput label="Date" value={draft.date} onChange={(value) => onChange({ date: value })} placeholder="YYYY-MM-DD" />
          <LabeledInput label="Time" value={draft.time} onChange={(value) => onChange({ time: value })} placeholder="HH:mm" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledToggle label="All day" value={draft.all_day} onChange={(value) => onChange({ all_day: value })} />
          <LabeledInput label="Location" value={draft.location} onChange={(value) => onChange({ location: value })} placeholder="場所" />
        </div>

        <LabeledTextarea
          label="Confirmation"
          value={draft.confirmation}
          onChange={(value) => onChange({ confirmation: value })}
          placeholder="確認文"
          rows={3}
        />
        <LabeledInput
          label="note_tags"
          value={draft.note_tags}
          onChange={(value) => onChange({ note_tags: value })}
          placeholder="#tag #tag"
        />
        <LabeledTextarea
          label="note_index_line"
          value={draft.note_index_line}
          onChange={(value) => onChange({ note_index_line: value })}
          placeholder="YYYY-MM-DD | TYPE | #tag | summary"
          rows={3}
        />
        <LabeledTextarea
          label="user_intent_summary"
          value={draft.user_intent_summary}
          onChange={(value) => onChange({ user_intent_summary: value })}
          placeholder="検索しやすい1行要約"
          rows={3}
        />
      </div>
    </div>
  );
}

function RecordCard({
  record,
  onOpen,
  onEdit,
  onDelete,
  onRegisterGoogleTask,
  onToggleGoogleTaskStatus,
  onRegisterGoogleCalendarEvent,
  onOpenImage,
  onReanalyzeAttachment,
  onDeleteAttachment,
  onAddPhotos,
  onSyncOne,
  onAnalyzeDraft,
  onShowBadgeInfo,
  externalProcessingKey = "",
  isPhotoProcessing = false,
  isBackupProcessing = false,
  isChecked = false,
  onToggleCheck,
  isSelected = false,
}: {
  record: CGMPRecord;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRegisterGoogleTask: (id: string) => void;
  onToggleGoogleTaskStatus: (id: string) => void;
  onRegisterGoogleCalendarEvent: (id: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onReanalyzeAttachment: (recordId: string, attachmentId: string) => void;
  onDeleteAttachment: (recordId: string, attachmentId: string) => void;
  onAddPhotos: (recordId: string, files: File[]) => void;
  onSyncOne: (recordId: string) => void;
  onAnalyzeDraft: (recordId: string) => void;
  onShowBadgeInfo: (info: NonNullable<BadgeInfo>) => void;
  externalProcessingKey?: string;
  isPhotoProcessing?: boolean;
  isBackupProcessing?: boolean;
  isChecked?: boolean;
  onToggleCheck: (id: string) => void;
  isSelected?: boolean;
}) {
  const para = getEffectivePara(record);
  const rawText = record.raw_input || record.summary || record.body || "（原文なし）";
  const bodyText = record.body && record.body !== record.raw_input ? record.body : "";
  const intentText = record.user_intent_summary || record.confirmation || "";
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoBackupBadge = getPhotoBackupBadge(record);
  const taskProcessing = externalProcessingKey === `task:${record.id}` || externalProcessingKey === `task-status:${record.id}`;
  const calendarProcessing = externalProcessingKey === `calendar:${record.id}`;
  const draftProcessing = externalProcessingKey === `draft-ai:${record.id}`;
  const isDraft = record.ai_status === "pending_ai";
  const isTaskRegistered = Boolean(record.google_task_id && record.google_task_list_id);
  const isCalendarRegistered = Boolean(record.google_calendar_event_id);

  function handlePhotoFiles(files: File[]) {
    if (files.length === 0) return;
    onAddPhotos(record.id, files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(record.id)}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        onOpen(record.id);
      }}
      id={`record-card-${record.id}`}
      className="group w-full min-w-0 overflow-hidden scroll-mt-24 text-left"
      aria-expanded={isSelected}
    >
      <div
        className={`min-w-0 overflow-hidden rounded-[22px] border p-3 transition duration-300 sm:rounded-[24px] sm:p-4 ${
          isChecked
            ? "border-[color:var(--orange)] bg-[var(--orange-soft)] shadow-[0_16px_42px_var(--shadow-soft)]"
            : isSelected
            ? "border-[color:var(--accent)] bg-[var(--accent-soft)] shadow-[0_16px_42px_var(--shadow-soft)]"
            : "border-[color:var(--border)] bg-[var(--card)] group-hover:border-[color:var(--accent)] group-hover:bg-[var(--accent-soft)]"
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            role="checkbox"
            aria-checked={isChecked}
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCheck(record.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              event.stopPropagation();
              onToggleCheck(record.id);
            }}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition ${
              isChecked
                ? "border-[color:var(--orange)] bg-[var(--orange)] text-white shadow-[0_8px_18px_var(--shadow-soft)]"
                : "border-[color:var(--border)] bg-[var(--card)] text-transparent group-hover:border-[color:var(--accent)]"
            }`}
            aria-label={`${record.title || "メモ"}を選択`}
          >
            ✓
          </span>
          {isDraft ? (
            <Badge compact tone="amber">下書き</Badge>
          ) : (
            <>
              <Badge
                compact
                tone={record.action === "calendar" ? "amber" : record.action === "reminder" ? "rose" : record.action === "unclear" ? "slate" : "cyan"}
                title="Actionの意味を表示"
                onClick={() => onShowBadgeInfo(getActionInfo(record.action))}
              >
                {getActionLabel(record.action)}
              </Badge>
              <DomainBadge compact domain={record.domain || "other"} onClick={() => onShowBadgeInfo(getDomainInfo(record.domain || "other"))} />
              <Badge compact tone="slate" title="PARAの意味を表示" onClick={() => onShowBadgeInfo(getParaInfo(para))}>
                {getParaLabel(para)}
              </Badge>
              <Badge compact tone={getBackupTone(record)} title="同期状態の意味を表示" onClick={() => onShowBadgeInfo(getBackupInfo(record))}>
                {getBackupLabel(record)}
              </Badge>
            </>
          )}
          {!isDraft && photoBackupBadge ? (
            <Badge compact tone={photoBackupBadge.tone} title="写真同期状態の意味を表示" onClick={() => onShowBadgeInfo(getPhotoBackupInfo(record))}>
              {photoBackupBadge.label}
            </Badge>
          ) : null}
          {!isDraft && isTaskRegistered ? (
            <Badge compact tone={record.google_task_status === "completed" ? "emerald" : "amber"} title="Google Tasks状態の意味を表示" onClick={() => onShowBadgeInfo(getTaskInfo(record))}>
              {record.google_task_status === "completed" ? "Task完" : "Task未"}
            </Badge>
          ) : null}
          {!isDraft && isCalendarRegistered ? (
            <Badge compact tone="amber" title="Google Calendar状態の意味を表示" onClick={() => onShowBadgeInfo(getCalendarInfo())}>
              GCal
            </Badge>
          ) : null}
          {!isDraft && record.external_action_status === "failed" ? <Badge compact tone="rose">外部失敗</Badge> : null}
          <span className="min-w-0 max-w-full truncate text-[11px] text-[var(--subtle)]">
            {isDraft ? `created ${formatJstDateTime(record.created_at)}` : formatJstDateTime(record.updated_at)}
          </span>
          <div className="flex w-full max-w-full shrink-0 items-center justify-end gap-1.5 sm:ml-auto sm:w-auto">
            {isDraft ? (
              <button
                type="button"
                disabled={draftProcessing}
                onClick={(event) => {
                  event.stopPropagation();
                  onAnalyzeDraft(record.id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="whitespace-nowrap rounded-full border border-[color:var(--accent)] bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold text-[var(--accent-contrast)] shadow-[0_6px_16px_var(--shadow-soft)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {draftProcessing ? "解析中..." : "AI解析"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isBackupProcessing}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSyncOne(record.id);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="whitespace-nowrap rounded-full border border-[color:var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text)] shadow-[0_6px_16px_var(--shadow-soft)] transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  同期
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    event.stopPropagation();
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    handlePhotoFiles(files);
                  }}
                />
                <button
                  type="button"
                  disabled={isPhotoProcessing}
                  onClick={(event) => {
                    event.stopPropagation();
                    photoInputRef.current?.click();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="whitespace-nowrap rounded-full border border-[color:var(--accent)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] shadow-[0_6px_16px_var(--shadow-soft)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ＋写真
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-3">
          <h3 className="break-words text-base font-semibold text-[var(--text)]">{record.title || "（無題）"}</h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--muted)]">
            {record.summary || record.body || record.raw_input}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(record.tags || []).slice(0, 5).map((tag) => (
            <Badge key={tag} compact>{`#${tag}`}</Badge>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--subtle)]">
          {isDraft ? (
            <span>created {formatJstDateTime(record.created_at)}</span>
          ) : (
            <>
              <span>{record.date || "未設定日付"}</span>
              <span>{record.time || "未設定時刻"}</span>
              <span>{record.external_action_status}</span>
              {record.last_backup_at ? <span>backup {formatJstDateTime(record.last_backup_at)}</span> : null}
            </>
          )}
        </div>

        <ImageAttachmentGrid attachments={record.attachments} compact maxItems={3} onOpen={onOpenImage} />

        <div
          className={`overflow-hidden transition-[height,opacity,margin-top] duration-300 ease-out ${
            isSelected
              ? "mt-4 h-[28rem] opacity-100 sm:h-[30rem]"
              : "mt-0 h-0 opacity-0 group-focus-visible:mt-4 group-focus-visible:h-[28rem] group-focus-visible:opacity-100 sm:group-focus-visible:h-[30rem]"
          }`}
        >
          <div className="flex h-full flex-col rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--accent)]">Detail</div>
              <div className="flex flex-wrap gap-2">
                {isDraft ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAnalyzeDraft(record.id);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="rounded-xl border border-[color:var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={draftProcessing}
                  >
                    {draftProcessing ? "解析中..." : "AI解析"}
                  </button>
                ) : null}
                {!isDraft && record.action === "reminder" ? (
                  isTaskRegistered ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleGoogleTaskStatus(record.id);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 transition hover:border-teal-300 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={taskProcessing}
                    >
                      {taskProcessing ? "同期中..." : record.google_task_status === "completed" ? "未完了に戻す" : "完了にする"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRegisterGoogleTask(record.id);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={taskProcessing}
                    >
                      {taskProcessing ? "登録中..." : "Tasks登録"}
                    </button>
                  )
                ) : null}
                {!isDraft && record.action === "calendar" ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRegisterGoogleCalendarEvent(record.id);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={calendarProcessing || isCalendarRegistered}
                  >
                    {calendarProcessing ? "登録中..." : isCalendarRegistered ? "Cal登録済" : "Calendar登録"}
                  </button>
                ) : null}
                {!isDraft ? (
                  <>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSyncOne(record.id);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="rounded-xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isBackupProcessing}
                    >
                      1件同期
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        photoInputRef.current?.click();
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isPhotoProcessing}
                    >
                      写真追加
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(record.id);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                >
                  編集
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(record.id);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                >
                  削除
                </button>
              </div>
            </div>
            <div className="mt-3 flex-1 space-y-4 overflow-auto overscroll-contain pr-1 text-sm leading-6 text-[var(--text)]">
              <section>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">AI要約</div>
                <p className="mt-1 whitespace-pre-wrap break-words">{record.summary || "（要約なし）"}</p>
              </section>
              {intentText ? (
                <section>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Intent / Confirmation</div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{intentText}</p>
                </section>
              ) : null}
              {bodyText ? (
                <section>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">本文</div>
                  <pre className="mt-1 m-0 whitespace-pre-wrap break-words font-sans">{bodyText}</pre>
                </section>
              ) : null}
              <section>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">原文</div>
                <pre className="mt-1 m-0 whitespace-pre-wrap break-words font-sans">{rawText}</pre>
              </section>
              {(record.attachments || []).length > 0 ? (
                <section>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">写真</div>
                  <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                    <ImageAttachmentGrid
                      attachments={record.attachments}
                      onOpen={onOpenImage}
                      onReanalyze={(attachmentId) => onReanalyzeAttachment(record.id, attachmentId)}
                      onDelete={(attachmentId) => onDeleteAttachment(record.id, attachmentId)}
                    />
                  </div>
                </section>
              ) : null}
              <section>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">メタ情報</div>
                <div className="mt-1 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <span>作成: {formatJstDateTime(record.created_at)}</span>
                  <span>更新: {formatJstDateTime(record.updated_at)}</span>
                  <span>日付: {record.date || "未設定"}</span>
                  <span>時刻: {record.time || "未設定"}</span>
                  <span>場所: {record.location || "未設定"}</span>
                  <span>AI: {record.ai_status || "none"}</span>
                  {record.google_task_id ? <span>Task: {record.google_task_status || "needsAction"}</span> : null}
                  {record.google_calendar_event_id ? <span>Calendar: registered</span> : null}
                  {record.external_error ? <span className="text-rose-500">外部連携: {record.external_error}</span> : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniRecordCard({
  record,
  onOpen,
}: {
  record: CGMPRecord;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(record.id)}
      className="group w-full text-left"
    >
      <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card)] px-4 py-3 transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)]">
        <div className="flex items-center gap-2 text-[11px] text-[var(--subtle)]">
          <span>{record.updated_at ? formatJstDateTime(record.updated_at) : "未設定"}</span>
          <span>/</span>
          <span>{record.action || "note"}</span>
        </div>
        <div className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-[var(--text)]">
          {record.title || "（無題）"}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
          {record.summary || record.raw_input || ""}
        </p>
      </div>
    </button>
  );
}

function WeekRecordItem({
  record,
  isExpanded,
  onToggleExpanded,
  onOpenHome,
  onOpenImage,
  onToggleGoogleTaskStatus,
  externalProcessingKey,
}: {
  record: CGMPRecord;
  isExpanded: boolean;
  onToggleExpanded: (id: string) => void;
  onOpenHome: (id: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onToggleGoogleTaskStatus: (id: string) => void;
  externalProcessingKey: string;
}) {
  const timeline = getRecordTimeline(record);
  const isTaskRegistered = Boolean(record.google_task_id && record.google_task_list_id);
  const taskProcessing = externalProcessingKey === `task-status:${record.id}`;
  const detailBody = record.body || record.raw_input || "";
  const detailIntent = record.user_intent_summary || record.confirmation || "";

  return (
    <div
      id={`week-item-${record.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onToggleExpanded(record.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggleExpanded(record.id);
      }}
      className={`group w-full max-w-full cursor-pointer overflow-hidden rounded-[22px] border bg-[var(--card)] p-3 text-left transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:rounded-[24px] sm:p-4 ${
        isExpanded
          ? "border-[color:var(--accent)] shadow-[0_12px_34px_var(--shadow-soft)]"
          : "border-[color:var(--border)]"
      }`}
      aria-expanded={isExpanded}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="shrink-0 font-mono text-base font-semibold leading-6 text-[var(--text)] sm:text-lg">
          {timeline.timeLabel}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--card-soft)] px-2.5 py-1 text-xs text-[var(--subtle)]">
          {timeline.sourceLabel}
        </span>
        <span className="shrink-0 text-lg leading-none sm:text-xl">{getActionSymbol(record)}</span>
        <span className="shrink-0 text-lg leading-none sm:text-xl">{getDomainSymbol(record.domain)}</span>
        <h3 className="min-w-[12rem] flex-1 truncate text-base font-semibold leading-7 text-[var(--text)] sm:text-lg">
          {record.title || "（無題）"}
        </h3>
        {isTaskRegistered ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleGoogleTaskStatus(record.id);
            }}
            disabled={taskProcessing}
            className={`ml-auto shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-5 transition disabled:cursor-not-allowed disabled:opacity-50 ${
              record.google_task_status === "completed"
                ? "border-[color:var(--success)] bg-[var(--success-soft)] text-[var(--success)] hover:brightness-95"
                : "border-[color:var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)] hover:brightness-95"
            }`}
          >
            {taskProcessing ? "同期中" : record.google_task_status === "completed" ? "完了" : "未完"}
          </button>
        ) : null}
      </div>

      {!isExpanded && (record.attachments || []).length > 0 ? (
        <div className="mt-2" onClick={(event) => event.stopPropagation()}>
          <ImageAttachmentGrid attachments={record.attachments} compact maxItems={1} onOpen={onOpenImage} />
        </div>
      ) : null}

      <div
        className={`overflow-hidden transition-[max-height,opacity,margin-top] duration-300 ease-out ${
          isExpanded ? "mt-3 max-h-[42rem] opacity-100" : "mt-0 max-h-0 opacity-0"
        }`}
      >
        <div className="space-y-3 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-3 text-sm leading-6 text-[var(--text)]">
          <section>
            <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--subtle)]">Summary</div>
            <p className="mt-1 whitespace-pre-wrap break-words">{record.summary || "（要約なし）"}</p>
          </section>
          {detailIntent ? (
            <section>
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--subtle)]">Intent</div>
              <p className="mt-1 whitespace-pre-wrap break-words">{detailIntent}</p>
            </section>
          ) : null}
          {detailBody ? (
            <section>
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--subtle)]">
                {record.body ? "Body" : "Raw input"}
              </div>
              <pre className="mt-1 m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{detailBody}</pre>
            </section>
          ) : null}
          <section className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
            <span>created {formatJstDateTime(record.created_at)}</span>
            <span>updated {formatJstDateTime(record.updated_at)}</span>
            {record.date ? <span>date {record.date}</span> : null}
            {record.time ? <span>time {record.time}</span> : null}
          </section>
          {(record.attachments || []).length > 0 ? (
            <section onClick={(event) => event.stopPropagation()}>
              <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--subtle)]">Images</div>
              <div className="mt-2">
                <ImageAttachmentGrid attachments={record.attachments} compact maxItems={3} onOpen={onOpenImage} />
              </div>
            </section>
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenHome(record.id);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className="rounded-full border border-[color:var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)]"
            >
              Homeで開く
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeeklyMinimap({
  days,
  activeDay,
  todayKey,
}: {
  days: Array<{ date: Date; dateKey: string; records: CGMPRecord[] }>;
  activeDay: number;
  todayKey: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);

  const revealMinimap = () => {
    setIsExpanded(true);
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
    }
    collapseTimerRef.current = window.setTimeout(() => setIsExpanded(false), 1600);
  };

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  return (
    <aside
      onPointerDown={revealMinimap}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setIsExpanded(false);
      }}
      className={`fixed right-1 top-28 bottom-32 select-none overflow-hidden rounded-3xl border transition-all duration-200 sm:right-3 sm:top-20 sm:bottom-24 ${
        isExpanded
          ? "z-[70] w-16 border-[color:var(--border)] bg-[var(--card)] px-1.5 py-2 opacity-95 shadow-[0_18px_44px_var(--shadow-soft)] backdrop-blur-xl sm:w-[4.5rem]"
          : "z-30 w-9 border-transparent bg-transparent px-1 py-1 opacity-40 shadow-none backdrop-blur-none hover:opacity-70 sm:w-10"
      }`}
      aria-label="Weekly Minimap"
    >
      <div className={`flex h-full flex-col overflow-hidden ${isExpanded ? "gap-1.5" : "gap-1"}`}>
        {days.map((day, index) => {
          const isActive = activeDay === index;
          const isToday = day.dateKey === todayKey;
          return (
            <div
              key={day.dateKey}
              onClick={() => {
                revealMinimap();
                scrollToElementById(`week-day-${index}`);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                revealMinimap();
                scrollToElementById(`week-day-${index}`);
              }}
              role="button"
              tabIndex={0}
              className={`min-h-0 flex-1 rounded-2xl border transition ${
                isExpanded && isActive
                  ? "border-[color:var(--accent)] bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent)]"
                  : isExpanded
                    ? "border-transparent hover:border-[color:var(--border)] hover:bg-[var(--card-soft)]"
                    : "border-transparent bg-transparent shadow-none"
              } ${isExpanded ? "grid grid-cols-[1.65rem_minmax(0,1fr)] items-start gap-1 px-1.5 py-1" : "px-1 py-0.5 text-left"}`}
              aria-label={`${WEEKDAY_MINI_LABELS[index]}へ移動`}
            >
              <div
                className={`w-fit rounded-full px-1 font-semibold ${
                  isExpanded && isToday
                    ? "bg-[var(--card)] ring-1 ring-[color:var(--accent)] text-[var(--accent)]"
                  : isExpanded && isActive
                      ? "bg-[var(--card)] text-[var(--accent)]"
                      : "text-[var(--subtle)]"
                } ${isExpanded ? "sticky top-0 z-10 text-[10px] leading-4" : "mx-auto mb-0.5 text-[8px] leading-3"}`}
              >
                {WEEKDAY_MINI_LABELS[index]}
              </div>
              <div className={isExpanded ? "min-w-0 space-y-1 pt-0.5" : "space-y-0.5"}>
                {day.records.length > 0 ? (
                  day.records.map((record) => {
                    const color = getDomainColorVar(record.domain || "other");
                    return (
                      <div
                        key={record.id}
                        className={`flex w-full items-center overflow-hidden rounded-sm ${isExpanded ? "h-2.5" : "h-2"}`}
                        aria-hidden="true"
                      >
                        <span
                          className={`min-w-0 flex-1 rounded-full ${isExpanded ? "h-1 opacity-90" : "h-0.5 opacity-65"}`}
                          style={{ backgroundColor: color } as CSSProperties}
                        />
                      </div>
                    );
                  })
                ) : (
                  <div className="mx-auto h-0.5 w-3 rounded-full bg-[var(--border)] opacity-60" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function WeeklyView({
  weekStart,
  records,
  onPreviousWeek,
  onNextWeek,
  onThisWeek,
  onOpenRecord,
  onOpenImage,
  onToggleGoogleTaskStatus,
  externalProcessingKey,
}: {
  weekStart: Date;
  records: CGMPRecord[];
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onOpenRecord: (id: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onToggleGoogleTaskStatus: (id: string) => void;
  externalProcessingKey: string;
}) {
  const [activeDay, setActiveDay] = useState(0);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const todayKey = dateKeyFromDate(new Date());
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(weekStart, index);
        const dateKey = dateKeyFromDate(date);
        const dayRecords = records
          .filter((record) => getRecordTimeline(record).dateKey === dateKey)
          .sort((left, right) => {
            const leftTimeline = getRecordTimeline(left);
            const rightTimeline = getRecordTimeline(right);
            if (leftTimeline.sortValue !== rightTimeline.sortValue) {
              return leftTimeline.sortValue - rightTimeline.sortValue;
            }
            return String(left.created_at || left.updated_at).localeCompare(String(right.created_at || right.updated_at));
          });
        return { date, dateKey, records: dayRecords };
      }),
    [records, weekStart]
  );

  useEffect(() => {
    const sections = days
      .map((_, index) => document.getElementById(`week-day-${index}`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => {
            const leftTop = Math.abs(left.boundingClientRect.top - 140);
            const rightTop = Math.abs(right.boundingClientRect.top - 140);
            return leftTop - rightTop;
          });
        const target = visible[0]?.target;
        if (!target?.id) return;
        const index = Number(target.id.replace("week-day-", ""));
        if (Number.isFinite(index)) setActiveDay(index);
      },
      { root: null, rootMargin: "-20% 0px -55% 0px", threshold: 0.08 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [days]);

  useEffect(() => {
    setExpandedRecordId(null);
  }, [weekStart]);

  return (
    <div className="grid max-w-full gap-3 overflow-hidden sm:gap-4">
      <WeeklyMinimap days={days} activeDay={activeDay} todayKey={todayKey} />
      <section className={panelClass}>
        <SectionHeading eyebrow="Week" title="週次ログビュー" />
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <button type="button" onClick={onPreviousWeek} className={secondaryButtonClass}>
            前週
          </button>
          <div className="min-w-0 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2.5 text-center text-sm font-semibold text-[var(--text)]">
            {formatWeekRange(weekStart)}
          </div>
          <button type="button" onClick={onNextWeek} className={secondaryButtonClass}>
            次週
          </button>
          <button type="button" onClick={onThisWeek} className={`${primaryButtonClass} col-span-3`}>
            Today / This Week
          </button>
        </div>
      </section>

      <section className="grid max-w-full gap-3 overflow-hidden">
        {days.map(({ date, dateKey, records: dayRecords }, index) => {
          const day = date.getDay();
          const isToday = dateKey === todayKey;
          const weekendStyle =
            day === 6
              ? { backgroundColor: "var(--week-saturday-bg)" }
              : day === 0
                ? { backgroundColor: "var(--week-sunday-bg)" }
                : undefined;
          const cardStyle = isToday
            ? { backgroundColor: "var(--today-bg)", borderColor: "var(--accent)" }
            : weekendStyle;

          return (
            <article
              id={`week-day-${index}`}
              key={dateKey}
              className="max-w-full overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[var(--card)] p-4 shadow-[0_12px_34px_var(--shadow-soft)] sm:p-5"
              style={cardStyle}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-[var(--text)]">{WEEKDAY_LABELS[day]}</h3>
                    {isToday ? <Badge compact tone="cyan">Today</Badge> : null}
                    {day === 6 ? <Badge compact tone="cyan">Sat</Badge> : null}
                    {day === 0 ? <Badge compact tone="rose">Sun</Badge> : null}
                  </div>
                  <div className="mt-1 text-base text-[var(--muted)]">{formatWeekDate(date)}</div>
                </div>
                <Badge tone={dayRecords.length > 0 ? "emerald" : "slate"}>{dayRecords.length}件</Badge>
              </div>

              <div className="mt-4 grid gap-2">
                {dayRecords.length > 0 ? (
                  dayRecords.map((record) => (
                    <WeekRecordItem
                      key={record.id}
                      record={record}
                      isExpanded={expandedRecordId === record.id}
                      onToggleExpanded={(id) => {
                        setExpandedRecordId((current) => (current === id ? null : id));
                      }}
                      onOpenHome={onOpenRecord}
                      onOpenImage={onOpenImage}
                      onToggleGoogleTaskStatus={onToggleGoogleTaskStatus}
                      externalProcessingKey={externalProcessingKey}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[var(--subtle)]">
                    No records
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

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
  const [photoProcessingCount, setPhotoProcessingCount] = useState(0);
  const [externalProcessingKey, setExternalProcessingKey] = useState("");
  const [externalConfirm, setExternalConfirm] = useState<ExternalConfirmState>(null);
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
  const [relatedCandidates, setRelatedCandidates] = useState<SimilarRecord[]>([]);
  const [badgeInfo, setBadgeInfo] = useState<BadgeInfo>(null);
  const initialDriveImportDoneRef = useRef(false);
  const initialExternalSyncDoneRef = useRef(false);
  const aiProcessingIdRef = useRef(0);
  const aiProcessingHideTimerRef = useRef<number | null>(null);
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
    } finally {
      setBackupProcessing(false);
    }
  }

  async function saveExternalRecordUpdate(nextRecord: CGMPRecord) {
    const saved = await upsertRecord(nextRecord);
    setRecords((current) => current.map((record) => (record.id === saved.id ? saved : record)));
    if (selectedId === saved.id) {
      setDetailDraft(formFromRecord(saved));
    }
    await Promise.all([reloadRecords(), reloadBackupSummary()]);
    void runBackupQueue(false);
    return saved;
  }

  async function updateRegisteredExternalItems(record: CGMPRecord) {
    let nextRecord = record;
    const errors: string[] = [];

    if (record.google_task_id && record.google_task_list_id) {
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
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Google Tasks更新に失敗しました");
      }
    }

    if (record.google_calendar_event_id && record.google_calendar_id) {
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
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Google Calendar更新に失敗しました");
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
    const targets = records.filter(
      (record) => (record.google_task_id && record.google_task_list_id) || (record.google_calendar_event_id && record.google_calendar_id)
    );
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
    } finally {
      setExternalSyncing(false);
    }
  }

  async function registerGoogleTask(recordId: string) {
    const record = records.find((candidate) => candidate.id === recordId);
    if (!record) return;
    const processingKey = `task:${recordId}`;
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
      await saveExternalRecordUpdate({
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
      });
      setNotice({ kind: "info", text: "Google Tasksへ登録しました。" });
    } catch (error) {
      await saveExternalRecordUpdate({
        ...record,
        external_action_status: "failed",
        external_target: "reminder",
        external_error: error instanceof Error ? error.message : "Google Tasks登録に失敗しました",
      });
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Google Tasks登録に失敗しました",
      });
    } finally {
      setExternalProcessingKey("");
    }
  }

  async function toggleGoogleTaskStatus(recordId: string) {
    const record = records.find((candidate) => candidate.id === recordId);
    if (!record?.google_task_id || !record.google_task_list_id) return;
    const nextStatus: Exclude<CGMPGoogleTaskStatus, ""> =
      record.google_task_status === "completed" ? "needsAction" : "completed";
    const processingKey = `task-status:${recordId}`;
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
    } finally {
      setExternalProcessingKey("");
    }
  }

  async function registerGoogleCalendarEvent(recordId: string) {
    const record = records.find((candidate) => candidate.id === recordId);
    if (!record) return;
    const processingKey = `calendar:${recordId}`;
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
      await saveExternalRecordUpdate({
        ...record,
        updated_at: new Date().toISOString(),
        external_action_status: "registered",
        external_target: "calendar",
        external_registered_at: payload.updatedAt || new Date().toISOString(),
        external_error: "",
        google_calendar_event_id: payload.eventId,
        google_calendar_id: payload.calendarId,
        google_calendar_updated_at: payload.updatedAt || new Date().toISOString(),
      });
      setNotice({ kind: "info", text: "Google Calendarへ登録しました。" });
    } catch (error) {
      await saveExternalRecordUpdate({
        ...record,
        external_action_status: "failed",
        external_target: "calendar",
        external_error: error instanceof Error ? error.message : "Google Calendar登録に失敗しました",
      });
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Google Calendar登録に失敗しました",
      });
    } finally {
      setExternalProcessingKey("");
    }
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
    try {
      const result = await importMissingRecordsFromDrive();
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
    } catch (error) {
      if (showNotice) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Driveからの取り込みに失敗しました",
        });
      }
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

  async function suggestRelatedRecords(record: CGMPRecord) {
    try {
      const { index } = await createOrRefreshEmbedding(record, true);
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
        const [nextRecords, nextSettings, nextBackupSummary, nextDeletedRecords, nextEmbeddingIndex] = await Promise.all([
          loadAllRecords(),
          loadSettings(),
          getBackupStatus(),
          loadDeletedRecords(),
          loadEmbeddingIndex(),
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
    if (tab !== "settings" || deployInfo || deployInfoLoading) return;
    let cancelled = false;
    setDeployInfoLoading(true);
    fetch("/api/deploy-info")
      .then((response) => response.json())
      .then((payload: DeployInfo) => {
        if (!cancelled) setDeployInfo(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          setDeployInfo({
            ok: false,
            commitMessage: error instanceof Error ? error.message : "更新情報を取得できませんでした",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setDeployInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deployInfo, deployInfoLoading, tab]);

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
    if (!records.some((record) => record.google_task_id || record.google_calendar_event_id)) return;
    initialExternalSyncDoneRef.current = true;
    void syncExternalStatuses(false);
  }, [isReady, records]);

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
    await upsertRecord(nextRecord);
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

  async function analyzeDraftRecord(recordId: string) {
    if (externalProcessingKey) return;
    const latestRecords = await loadAllRecords();
    const draftRecord = latestRecords.find((record) => record.id === recordId);
    if (!draftRecord) {
      setNotice({ kind: "error", text: "下書きが見つかりません。" });
      return;
    }
    const rawInput = draftRecord.raw_input.trim();
    if (!rawInput) {
      setNotice({ kind: "error", text: "下書きのRaw inputが空です。" });
      return;
    }

    setExternalProcessingKey(`draft-ai:${recordId}`);
    const processingId = beginAiProcessing("text", "下書きAI解析中");
    try {
      const payload = await requestTextAnalysis(rawInput);
      const analyzedForm = applyAnalysisToDraft(formFromRecord(draftRecord), rawInput, payload.result);
      const nextRecord = formToRecord(analyzedForm, {
        existing: draftRecord,
        aiStatus: "done",
        aiError: "",
        aiMeta: {
          model: payload.model || settingsDraft?.openai_model || "gpt-4.1-nano",
          generated_at: payload.generated_at || new Date().toISOString(),
        },
        backupStatus: "pending_backup",
      });
      const savedRecord = await upsertRecord({
        ...nextRecord,
        backup_retry_count: 0,
        backup_last_error: "",
        backup_next_retry_at: "",
      });
      await Promise.all([reloadRecords(savedRecord.id), reloadBackupSummary()]);
      setNotice({ kind: "info", text: "下書きをAI解析して通常メモにしました。" });
      if (savedRecord.action === "reminder") {
        setExternalConfirm({ recordId: savedRecord.id, action: "reminder", title: savedRecord.title || "（無題）" });
      } else if (savedRecord.action === "calendar") {
        setExternalConfirm({ recordId: savedRecord.id, action: "calendar", title: savedRecord.title || "（無題）" });
      }
      window.setTimeout(() => {
        void runBackupQueue(false);
      }, 0);
      window.setTimeout(() => {
        void suggestRelatedRecords(savedRecord);
      }, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "下書きのAI解析に失敗しました";
      const failedDraft = await putRecordWithoutBackup({
        ...draftRecord,
        ai_status: "pending_ai",
        ai_error: message,
        backup_status: "local_only",
        updated_at: draftRecord.updated_at,
      });
      setRecords((current) => current.map((record) => (record.id === failedDraft.id ? failedDraft : record)));
      setNotice({ kind: "error", text: `下書きのAI解析に失敗しました: ${message}` });
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
      await upsertRecord(nextRecord);
      await reloadRecords(nextRecord.id);
      await reloadBackupSummary();
      setNotice({ kind: "info", text: "保存しました。" });
      if (nextRecord.action === "reminder") {
        setExternalConfirm({ recordId: nextRecord.id, action: "reminder", title: nextRecord.title || "（無題）" });
      } else if (nextRecord.action === "calendar") {
        setExternalConfirm({ recordId: nextRecord.id, action: "calendar", title: nextRecord.title || "（無題）" });
      }
      window.setTimeout(() => {
        void runBackupQueue(false);
      }, 0);
      window.setTimeout(() => {
        void suggestRelatedRecords(nextRecord);
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

        {externalConfirm || relatedCandidates.length > 0 ? (
          <div className="fixed inset-0 z-[92] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
            <div
              className={`grid w-full gap-3 ${
                externalConfirm && relatedCandidates.length > 0 ? "max-w-5xl sm:grid-cols-2" : "max-w-lg"
              }`}
            >
              {externalConfirm ? (
                <section className="w-full rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
                  <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Google Sync</div>
                  <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">
                    {externalConfirm.action === "calendar" ? "Google Calendarにも登録しますか？" : "Google Tasksにも登録しますか？"}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    「{externalConfirm.title}」を保存しました。Google側にも作成すると、以後の完了状態や日時変更をCGMPと同期できます。
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" onClick={confirmExternalRegistration} className={primaryButtonClass}>
                      登録する
                    </button>
                    <button type="button" onClick={() => setExternalConfirm(null)} className={secondaryButtonClass}>
                      今はしない
                    </button>
                  </div>
                </section>
              ) : null}

              {relatedCandidates.length > 0 ? (
                <section className="w-full rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
                  <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Related Notes</div>
                  <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">こんなの関連しませんか？</h2>
                  <div className="mt-4 max-h-[50vh] space-y-3 overflow-auto pr-1">
                    {relatedCandidates.map((item) => (
                      <article key={item.record.id} className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <DomainBadge domain={item.record.domain || "other"} />
                          <Badge compact tone={item.record.action === "calendar" ? "amber" : item.record.action === "reminder" ? "rose" : "cyan"}>
                            {item.record.action}
                          </Badge>
                          <Badge compact tone={item.level === "strong" ? "emerald" : "slate"}>
                            関連度 {item.level === "strong" ? "高" : "中"} {Math.round(item.score * 100)}%
                          </Badge>
                        </div>
                        <h3 className="mt-3 text-base font-semibold text-[var(--text)]">{item.record.title || "Untitled"}</h3>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--muted)]">
                          {item.record.summary || item.record.body || item.record.raw_input}
                        </p>
                        {(item.record.tags || []).length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(item.record.tags || []).slice(0, 4).map((tag) => (
                              <Badge compact key={tag}>#{tag}</Badge>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setRelatedCandidates([]);
                              setSelectedId(item.record.id);
                              setTab("home");
                              window.setTimeout(() => {
                                document.getElementById(`record-card-${item.record.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }, 80);
                            }}
                            className={secondaryButtonClass}
                          >
                            開く
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="mt-5 flex justify-end">
                    <button type="button" onClick={() => setRelatedCandidates([])} className={primaryButtonClass}>
                      閉じる
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        ) : null}

        {externalSyncProgress ? (
          <div className="fixed inset-0 z-[95] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
            {(() => {
              const done = externalSyncProgress.phase === "done" || externalSyncProgress.phase === "error";
              const elapsed = Math.round((externalSyncProgress.finishedAt || performance.now()) - externalSyncProgress.startedAt);
              const activeCount =
                externalSyncProgress.phase === "applying"
                  ? externalSyncProgress.applied
                  : Math.max(externalSyncProgress.checked, externalSyncProgress.applied);
              const ratio = Math.min(100, Math.round((activeCount / Math.max(1, externalSyncProgress.total)) * 100));
              const slowestItems = [...externalSyncProgress.reportItems]
                .sort((a, b) => b.elapsedMs + b.applyElapsedMs - (a.elapsedMs + a.applyElapsedMs))
                .slice(0, 6);
              return (
                <section className="w-full max-w-md rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
                  <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Google Sync</div>
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--text)]">
                        {externalSyncProgress.phase === "done"
                          ? "同期が完了しました"
                          : externalSyncProgress.phase === "error"
                            ? "同期で停止しました"
                            : "Google状態を同期中"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{externalSyncProgress.message}</p>
                    </div>
                    {!done ? (
                      <div className="mt-1 h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">
                        {externalSyncProgress.phase === "done" ? "✓" : "!"}
                      </div>
                    )}
                  </div>
                  {externalSyncProgress.currentTitle ? (
                    <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
                      {externalSyncProgress.currentTitle}
                    </div>
                  ) : null}
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                      style={{ width: `${ratio}%` }}
                    />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      照合 {externalSyncProgress.checked}/{externalSyncProgress.total}
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      反映 {externalSyncProgress.applied}/{externalSyncProgress.total}
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      更新 {externalSyncProgress.changed}件
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      失敗 {externalSyncProgress.failed}件
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-[var(--subtle)]">経過 {elapsed} ms</div>
                  {done ? (
                    <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3 text-xs text-[var(--muted)]">
                      <div className="font-semibold text-[var(--text)]">同期レポート</div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <span>照合: {externalSyncProgress.checkingElapsedMs} ms</span>
                        <span>反映: {externalSyncProgress.applyingElapsedMs} ms</span>
                        <span>再読込: {externalSyncProgress.reloadElapsedMs} ms</span>
                        <span>合計: {elapsed} ms</span>
                      </div>
                      {slowestItems.length > 0 ? (
                        <div className="mt-3">
                          <div className="font-semibold text-[var(--text)]">遅い順</div>
                          <div className="mt-2 max-h-44 space-y-2 overflow-auto pr-1">
                            {slowestItems.map((item) => (
                              <div key={item.recordId} className="rounded-xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                                <div className="truncate font-semibold text-[var(--text)]">
                                  {item.ok ? "" : "失敗: "}
                                  {item.title}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                                  <span>total {item.elapsedMs}ms</span>
                                  {item.hasTask ? <span>Tasks {item.taskElapsedMs}ms</span> : null}
                                  {item.hasCalendar ? <span>Calendar {item.calendarElapsedMs}ms</span> : null}
                                  <span>反映 {item.applyElapsedMs}ms</span>
                                  {item.changed ? <span>更新あり</span> : <span>変更なし</span>}
                                </div>
                                {item.error ? <div className="mt-1 text-[11px] text-[var(--danger)]">{item.error}</div> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <p className="mt-3 text-[11px] leading-5 text-[var(--subtle)]">
                        この内容はブラウザconsoleにも出力しています。スクショやconsoleログを見れば、どこが遅いか追いやすくなります。
                      </p>
                    </div>
                  ) : null}
                  {done ? (
                    <div className="mt-5 flex justify-end">
                      <button type="button" onClick={() => setExternalSyncProgress(null)} className={secondaryButtonClass}>
                        閉じる
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })()}
          </div>
        ) : null}

        {backupSyncProgress ? (
          <div className="fixed inset-0 z-[95] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
            {(() => {
              const done = backupSyncProgress.phase === "done" || backupSyncProgress.phase === "error";
              const elapsed = Math.round(
                (backupSyncProgress.finishedAt || backupProgressNow || performance.now()) - backupSyncProgress.startedAt
              );
              const detailItems =
                backupSyncProgress.reportItems.length <= 20
                  ? backupSyncProgress.reportItems
                  : [...backupSyncProgress.reportItems].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 20);
              return (
                <section className="w-full max-w-md rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
                  <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Drive Backup</div>
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--text)]">
                        {backupSyncProgress.phase === "done"
                          ? "バックアップが完了しました"
                          : backupSyncProgress.phase === "error"
                            ? "バックアップで停止しました"
                            : "Google Driveへ同期中"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{backupSyncProgress.message}</p>
                    </div>
                    {!done ? (
                      <div className="mt-1 h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">
                        {backupSyncProgress.phase === "done" ? "✓" : "!"}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      対象 {backupSyncProgress.total}件
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      成功 {backupSyncProgress.succeeded}件
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      失敗 {backupSyncProgress.failed}件
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      経過 {elapsed} ms
                    </div>
                  </div>
                  {done ? (
                    <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3 text-xs text-[var(--muted)]">
                      <div className="font-semibold text-[var(--text)]">Drive同期レポート</div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <span>処理: {backupSyncProgress.processElapsedMs} ms</span>
                        <span>再読込: {backupSyncProgress.reloadElapsedMs} ms</span>
                        <span>合計: {elapsed} ms</span>
                        <span>対象: {backupSyncProgress.total}件</span>
                      </div>
                      {detailItems.length > 0 ? (
                        <div className="mt-3">
                          <div className="font-semibold text-[var(--text)]">
                            {backupSyncProgress.reportItems.length <= 20 ? "処理詳細" : "遅い順 20件"}
                          </div>
                          <div className="mt-2 max-h-44 space-y-2 overflow-auto pr-1">
                            {detailItems.map((item) => (
                              <div
                                key={`${item.recordId}:${item.itemType}:${item.attachmentId}`}
                                className="rounded-xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2"
                              >
                                <div className="truncate font-semibold text-[var(--text)]">
                                  {item.ok ? "" : "失敗: "}
                                  {item.title}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                                  <span>{item.skipped ? "SKIP" : item.ok ? "OK" : "FAILED"}</span>
                                  <span>{item.itemType}</span>
                                  {item.attachmentId ? <span>attachment {item.attachmentId}</span> : null}
                                  <span>total {item.elapsedMs}ms</span>
                                  {item.blobElapsedMs > 0 ? <span>画像読込 {item.blobElapsedMs}ms</span> : null}
                                  {item.uploadElapsedMs > 0 ? <span>Upload {item.uploadElapsedMs}ms</span> : null}
                                  {item.previewSizeBytes > 0 ? <span>{Math.round(item.previewSizeBytes / 1024)}KB</span> : null}
                                </div>
                                {item.error ? <div className="mt-1 text-[11px] text-[var(--danger)]">{item.error}</div> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <p className="mt-3 text-[11px] leading-5 text-[var(--subtle)]">
                        この内容はブラウザconsoleにも出力しています。Drive同期が遅い原因の切り分けに使えます。
                      </p>
                    </div>
                  ) : null}
                  {done ? (
                    <div className="mt-5 flex justify-end">
                      <button type="button" onClick={() => setBackupSyncProgress(null)} className={secondaryButtonClass}>
                        閉じる
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })()}
          </div>
        ) : null}

        {isWebhookTestModalOpen ? (
          <div className="fixed inset-0 z-[95] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
            {(() => {
              const trace = webhookTestReport?.debugTrace;
              const steps =
                trace?.steps ||
                ([
                  { id: "received", label: "Webhook受信", status: "running" },
                  { id: "duplicate_lookup", label: "重複チェック", status: "running" },
                  { id: "ai_analyze", label: "AI解析", status: "running" },
                  { id: "external_register", label: "Google Tasks / Calendar登録", status: "running" },
                  { id: "initial_drive_backup", label: "Drive初回バックアップ", status: "running" },
                  { id: "final_drive_backup", label: "外部ID反映バックアップ", status: "running" },
                ] as Array<Partial<ShortcutWebhookTraceStep> & { id: string; label: string; status: ShortcutWebhookTraceStep["status"] }>);
              const done = !webhookTestRunning && Boolean(webhookTestReport);
              const elapsed = trace?.totalElapsedMs ?? webhookTestElapsedMs;
              const statusTone = webhookTestReport?.ok ? "text-[var(--accent)]" : webhookTestReport ? "text-[var(--danger)]" : "text-[var(--muted)]";
              return (
                <section className="w-full max-w-xl rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
                  <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Webhook Test</div>
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--text)]">
                        {done ? "Webhookテストが完了しました" : "Webhookと同じ処理を実行中"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        同じ `/api/shortcut-webhook` にdebug付きでPOSTしています。新しい処理経路は使っていません。
                      </p>
                    </div>
                    {!done ? (
                      <div className="mt-1 h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
                    ) : (
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--card-soft)] text-sm font-bold ${statusTone}`}>
                        {webhookTestReport?.ok ? "✓" : "!"}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      経過 {elapsed} ms
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      結果 {webhookTestReport ? (webhookTestReport.ok ? "成功" : "失敗") : "実行中"}
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      Action {webhookTestReport?.action || "-"}
                    </div>
                    <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
                      Date {webhookTestReport?.date || "-"} {webhookTestReport?.time || ""}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3 text-xs text-[var(--muted)]">
                    <div className="font-semibold text-[var(--text)]">処理ステップ</div>
                    <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                      {steps.map((step) => {
                        const stepStatus = step.status || "running";
                        const badgeClass =
                          stepStatus === "success"
                            ? "border-[color:var(--accent)] text-[var(--accent)]"
                            : stepStatus === "error"
                              ? "border-[color:var(--danger)] text-[var(--danger)]"
                              : stepStatus === "skipped"
                                ? "border-[color:var(--border)] text-[var(--subtle)]"
                                : "border-[color:var(--orange)] text-[var(--orange)]";
                        return (
                          <div key={step.id} className="rounded-xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-[var(--text)]">{step.label}</div>
                                {step.detail ? <div className="mt-1 text-[11px] leading-4 text-[var(--subtle)]">{step.detail}</div> : null}
                              </div>
                              <div className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${badgeClass}`}>
                                {stepStatus}
                              </div>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                              {typeof step.startedAt === "number" ? <span>start {step.startedAt}ms</span> : null}
                              {typeof step.elapsedMs === "number" ? <span>elapsed {step.elapsedMs}ms</span> : null}
                            </div>
                            {step.error ? <div className="mt-1 text-[11px] leading-5 text-[var(--danger)]">{step.error}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                    {webhookTestReport?.confirmationText ? (
                      <div className="mt-3 rounded-xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2 text-sm leading-6 text-[var(--text)]">
                        {webhookTestReport.confirmationText}
                      </div>
                    ) : null}
                    {webhookTestReport?.error ? (
                      <div className="mt-3 rounded-xl border border-[color:var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs leading-5 text-[var(--danger)]">
                        {webhookTestReport.error}
                      </div>
                    ) : null}
                  </div>

                  {done ? (
                    <div className="mt-5 flex justify-end">
                      <button type="button" onClick={() => setIsWebhookTestModalOpen(false)} className={secondaryButtonClass}>
                        閉じる
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })()}
          </div>
        ) : null}

        {isPromptEditorOpen ? (
          <div className="fixed inset-0 z-[96] overflow-y-auto overscroll-contain bg-white/70 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm dark:bg-slate-950/60 sm:px-4 sm:py-6">
            {(() => {
              const activeDefinition =
                promptDefinitions.find((item) => item.key === activePromptKey) || promptDefinitions[0] || null;
              const activePrompt = activeDefinition
                ? promptConfigDraft?.prompts?.[activeDefinition.key]?.userPrompt || activeDefinition.defaultUserPrompt
                : "";
              const activePromptRows = Math.min(42, Math.max(14, activePrompt.split("\n").length + 2));
              return (
                <section className="mx-auto my-2 w-full max-w-5xl rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-4 shadow-[0_28px_90px_var(--shadow-soft)] sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="section-eyebrow">Prompt Settings</div>
                      <h2 className="mt-2 text-2xl font-semibold text-[var(--text)]">AIプロンプト編集</h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        ここではAIの判断方針だけを編集します。JSON形式・必須フィールド・余計な文章禁止などの出力制約は非表示で固定しています。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPromptEditorOpen(false)}
                      className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}
                    >
                      閉じる
                    </button>
                  </div>

                  {promptConfigError ? (
                    <div className="mt-4 rounded-2xl border border-[color:var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
                      {promptConfigError}
                    </div>
                  ) : null}

                  {promptConfigLoading ? (
                    <div className="mt-5 flex min-h-64 items-center justify-center rounded-3xl border border-[color:var(--border)] bg-[var(--card-soft)] text-sm text-[var(--muted)]">
                      Google Driveからプロンプト設定を読み込み中...
                    </div>
                  ) : (
                    <div className="mt-5 grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                      <div className="max-h-72 space-y-2 overflow-auto rounded-3xl border border-[color:var(--border)] bg-[var(--card-soft)] p-2 overscroll-contain md:max-h-[64dvh]">
                        {promptDefinitions.length > 0 ? (
                          promptDefinitions.map((definition) => {
                            const isActive = activeDefinition?.key === definition.key;
                            return (
                              <button
                                key={definition.key}
                                type="button"
                                onClick={() => setActivePromptKey(definition.key)}
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
                                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                                  {activeDefinition.description}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={resetActivePromptToDefault}
                                className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}
                              >
                                初期値へ
                              </button>
                            </div>
                            <textarea
                              value={activePrompt}
                              onChange={(event) => updatePromptDraft(activeDefinition.key, event.target.value)}
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
                    <button
                      type="button"
                      onClick={loadPromptConfigForEditor}
                      disabled={promptConfigLoading || promptConfigSaving}
                      className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}
                    >
                      Driveから再読込
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPromptEditorOpen(false)}
                      className={`${secondaryButtonClass} shrink-0 whitespace-nowrap`}
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={savePromptConfig}
                      disabled={!promptConfigDraft || promptConfigLoading || promptConfigSaving}
                      className={`${primaryButtonClass} shrink-0 whitespace-nowrap`}
                    >
                      {promptConfigSaving ? "保存中..." : "Google Driveへ保存"}
                    </button>
                  </div>
                </section>
              );
            })()}
          </div>
        ) : null}

        {tab === "home" ? (
          <div className="grid min-w-0 gap-3 sm:gap-4">
            <section className={panelClass}>
              <SectionHeading
                eyebrow="Home"
                title="一覧・検索・フィルター"
              />

              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <LabeledInput label="Text search" value={query} onChange={setQuery} placeholder="title / summary / body" />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFilterOpen((open) => !open)}
                    className={secondaryButtonClass}
                    aria-expanded={isFilterOpen}
                  >
                    {isFilterOpen ? "フィルターを閉じる" : `フィルター${activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}`}
                  </button>
                  <button type="button" onClick={() => setTab("compose")} className={primaryButtonClass}>
                    新規入力へ
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {[
                  { value: "text", label: "通常検索" },
                  { value: "semantic", label: "意味検索" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSearchMode(item.value as SearchMode)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      searchMode === item.value
                        ? "border-[color:var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                        : "border-[color:var(--border)] bg-[var(--card-soft)] text-[var(--muted)]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
                {searchMode === "semantic" ? (
                  <span className="text-xs text-[var(--muted)]">
                    {semanticStatusText}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 min-w-0">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--subtle)]">
                    Domain
                  </span>
                  {DOMAIN_FILTER_OPTIONS.map((item) => {
                    const isActive = domainFilter === item.value;
                    const color = getDomainColorVar(item.value);
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setDomainFilter(isActive ? "all" : item.value)}
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                          isActive ? "shadow-[0_8px_18px_var(--shadow-soft)]" : "opacity-70 hover:opacity-100"
                        }`}
                        style={{
                          color,
                          borderColor: color,
                          backgroundColor: isActive
                            ? `color-mix(in srgb, ${color} 18%, var(--card))`
                            : `color-mix(in srgb, ${color} 7%, var(--card))`,
                        }}
                        aria-pressed={isActive}
                        title={`${item.value}で絞り込み${isActive ? "を解除" : ""}`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className={`overflow-hidden transition-[max-height,opacity,margin-top] duration-300 ease-out ${
                  isFilterOpen ? "mt-3 max-h-[32rem] opacity-100" : "mt-0 max-h-0 opacity-0"
                }`}
              >
                <div className="rounded-[20px] border border-[color:var(--border)] bg-[var(--card-soft)] p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabeledInput label="Tag search" value={tagQuery} onChange={setTagQuery} placeholder="例: 仕様" />
                    <LabeledSelect
                      label="並び順"
                      value={sortKey}
                      onChange={(value) =>
                        setSortKey(value === "datetime" ? "datetime" : value === "created_at" ? "created_at" : "updated_at")
                      }
                      options={[
                        { value: "updated_at", label: "更新順" },
                        { value: "created_at", label: "作成順" },
                        { value: "datetime", label: "日時順" },
                      ]}
                    />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <LabeledSelect
                      label="Action"
                      value={actionFilter}
                      onChange={(value) => setActionFilter(value === "all" ? "all" : normalizeAction(value))}
                      options={[
                        { value: "all", label: "すべて" },
                        { value: "note", label: "note" },
                        { value: "reminder", label: "reminder" },
                        { value: "calendar", label: "calendar" },
                        { value: "unclear", label: "unclear" },
                      ]}
                    />
                    <LabeledSelect
                      label="Domain"
                      value={domainFilter}
                      onChange={(value) => setDomainFilter(value === "all" ? "all" : normalizeDomain(value))}
                      options={[
                        { value: "all", label: "すべて" },
                        { value: "work", label: "work" },
                        { value: "family", label: "family" },
                        { value: "self", label: "self" },
                        { value: "health", label: "health" },
                        { value: "finance", label: "finance" },
                        { value: "learning", label: "learning" },
                        { value: "creation", label: "creation" },
                        { value: "life_admin", label: "life_admin" },
                        { value: "other", label: "other" },
                      ]}
                    />
                    <LabeledSelect
                      label="PARA"
                      value={paraFilter}
                      onChange={(value) => setParaFilter(value === "all" ? "all" : normalizePara(value))}
                      options={[
                        { value: "all", label: "すべて" },
                        { value: "project", label: "project" },
                        { value: "area", label: "area" },
                        { value: "resource", label: "resource" },
                        { value: "archive", label: "archive" },
                      ]}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => {
                      setQuery("");
                      setTagQuery("");
                      setActionFilter("all");
                      setDomainFilter("all");
                      setParaFilter("all");
                      setSortKey("updated_at");
                    }} className={secondaryButtonClass}>
                      クリア
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid min-w-0 gap-3 overflow-hidden">
              {filteredRecords.length > 0 ? (
                filteredRecords.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    onOpen={(id) => setSelectedId((current) => (current === id ? null : id))}
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
                    onAnalyzeDraft={analyzeDraftRecord}
                    onShowBadgeInfo={setBadgeInfo}
                    externalProcessingKey={externalProcessingKey}
                    isPhotoProcessing={photoProcessingCount > 0}
                    isBackupProcessing={backupProcessing}
                    isChecked={checkedRecordIds.includes(record.id)}
                    onToggleCheck={toggleCheckedRecord}
                    isSelected={record.id === selectedId}
                  />
                ))
              ) : (
                <div className={`${softPanelClass} text-sm text-slate-500`}>
                  条件に一致する記録がありません。まずは Compose で1件保存してみてください。
                </div>
              )}
            </section>
          </div>
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
          <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <section className={panelClass}>
              <SectionHeading
                eyebrow="Compose"
                title="入力 → AI解析 → 確認"
              />

              <div className="space-y-4">
                <LabeledTextarea
                  label="Raw input"
                  value={composeDraft.raw_input}
                  onChange={(value) => setComposeDraft((prev) => ({ ...prev, raw_input: value, body: prev.body || value }))}
                  placeholder="雑に入れたメモをそのまま貼る"
                  rows={10}
                  inputRef={composeRawInputRef}
                />

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleAnalyze} disabled={composeLoading} className={primaryButtonClass}>
                    {composeLoading ? "解析中..." : "AI解析"}
                  </button>
                  <button type="button" onClick={() => saveCompose(true)} className={secondaryButtonClass}>
                    AIなしで保存
                  </button>
                  <button type="button" onClick={() => void saveComposeDraft()} className={secondaryButtonClass}>
                    下書きとして保存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setComposeDraft(blankForm(""));
                      setComposeAiStatus("none");
                      setComposeAiError("");
                      setComposeAiMeta(null);
                    }}
                    className={secondaryButtonClass}
                  >
                    クリア
                  </button>
                </div>

                <div className={softPanelClass}>
                  <div className="text-sm font-medium text-slate-800">AI状態</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge tone={composeAiStatus === "done" ? "emerald" : composeAiStatus === "error" ? "rose" : "slate"}>
                      {composeAiStatus}
                    </Badge>
                    {composeAiMeta ? <Badge tone="cyan">{composeAiMeta.model}</Badge> : null}
                    {composeAiError ? <span className="text-rose-200">{composeAiError}</span> : null}
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
                  <button type="button" onClick={() => saveCompose()} className={primaryButtonClass}>
                    保存
                  </button>
                  <button type="button" onClick={() => setTab("home")} className={secondaryButtonClass}>
                    一覧へ
                  </button>
                </div>
              </div>

              <div className="max-h-[74vh] overflow-auto pr-1">
                <RecordEditor
                  draft={composeDraft}
                  onChange={(patch) => setComposeDraft((prev) => ({ ...prev, ...patch }))}
                  showRawInput={false}
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={() => saveCompose()} className={primaryButtonClass}>
                  保存
                </button>
                <button type="button" onClick={() => setTab("home")} className={secondaryButtonClass}>
                  一覧へ戻る
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {tab === "settings" ? (
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
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2">
          {[
            { key: "home", label: "Home" },
            { key: "week", label: "Week" },
            { key: "compose", label: "Compose" },
            { key: "settings", label: "Settings" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key as AppTab)}
              className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
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
