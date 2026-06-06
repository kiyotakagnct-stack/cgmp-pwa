import { SEMANTIC_CANDIDATE_THRESHOLD } from "@/lib/cgmp/embedding";
import type { CGMPAction, CGMPAnalysis, CGMPDomain, CGMPPara, CGMPRecord, CGMPSettings } from "@/lib/cgmp/types";
import { createId, makePreviewTitle, normalizeAction, normalizeDomain, normalizePara, parseTags, tagsToHashtags } from "@/lib/cgmp/utils";

export type ThemeMode = "system" | "light" | "dark";
export type BadgeInfo = {
  title: string;
  label: string;
  description: string;
  examples?: string[];
} | null;

export type RecordFormState = {
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

export const THEME_STORAGE_KEY = "cgmp_theme";

export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = mode;
}

export function blankForm(text = ""): RecordFormState {
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

export function formFromRecord(record: CGMPRecord): RecordFormState {
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

export function formToRecord(
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

export function getRecordText(record: CGMPRecord) {
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

export function getMiniListText(record: CGMPRecord) {
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

export function applyAnalysisToDraft(draft: RecordFormState, rawInput: string, analysis: CGMPAnalysis): RecordFormState {
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

export function getDraftRecordTitle(rawInput: string) {
  return makePreviewTitle(rawInput) || "下書き";
}

export function getDateSortValue(record: CGMPRecord) {
  const date = record.date || "";
  const time = record.time || "";
  const stamp = `${date}T${time || "00:00"}:00`;
  const parsed = new Date(stamp);
  const value = parsed.getTime();
  return Number.isFinite(value) ? value : new Date(record.updated_at || record.created_at).getTime();
}

export function matchesQuery(record: CGMPRecord, query: string, tagQuery: string) {
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

export function getEffectivePara(record: CGMPRecord) {
  const para = normalizePara(record.para);
  return para || "area";
}

export function matchesMiniQuery(record: CGMPRecord, query: string) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => getMiniListText(record).includes(token));
}

export function getBackupLabel(record: CGMPRecord) {
  if (record.backup_status === "backed_up") return "同期済";
  if (record.backup_status === "backing_up") return "同期中";
  if (record.backup_status === "pending_backup") return "未同期";
  if (record.backup_status === "backup_failed") return "同期失敗";
  if (record.backup_status === "conflicted") return "競合";
  return "端末";
}

export function getBackupTone(record: CGMPRecord): "slate" | "cyan" | "emerald" | "amber" | "rose" {
  if (record.backup_status === "backed_up") return "emerald";
  if (record.backup_status === "backing_up") return "cyan";
  if (record.backup_status === "pending_backup") return "amber";
  if (record.backup_status === "backup_failed" || record.backup_status === "conflicted") return "rose";
  return "slate";
}

export function getPhotoBackupBadge(record: CGMPRecord): { label: string; tone: "slate" | "cyan" | "emerald" | "amber" | "rose" } | null {
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

export function getActionLabel(action: CGMPAction) {
  if (action === "calendar") return "Cal";
  if (action === "reminder") return "Rem";
  if (action === "unclear") return "?";
  return "Note";
}

export function getParaLabel(para: CGMPPara) {
  if (para === "project") return "P";
  if (para === "resource") return "R";
  if (para === "archive") return "Arc";
  return "Area";
}

export function getDomainLabel(domain: CGMPDomain | string) {
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

export function getActionInfo(action: CGMPAction): NonNullable<BadgeInfo> {
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

export function getParaInfo(para: CGMPPara): NonNullable<BadgeInfo> {
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

export function getDomainInfo(domain: CGMPDomain | string): NonNullable<BadgeInfo> {
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

export function getBackupInfo(record: CGMPRecord): NonNullable<BadgeInfo> {
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

export function getPhotoBackupInfo(record: CGMPRecord): NonNullable<BadgeInfo> {
  const badge = getPhotoBackupBadge(record);
  return {
    title: "Photo Sync",
    label: badge?.label || "写真なし",
    description: "添付画像のGoogle Drive同期状態です。メモ本文とは別に、画像本体のアップロード状況を管理しています。",
    examples: ["写済: 画像同期済み", "写未: 未同期画像あり", "写失敗: 画像アップロードに失敗"],
  };
}

export function getTaskInfo(record: CGMPRecord): NonNullable<BadgeInfo> {
  return {
    title: "Google Tasks",
    label: record.google_task_status === "completed" ? "Task完" : "Task未",
    description: "Google Tasks側の完了状態です。Task未は未完了、Task完は完了済みを表します。",
  };
}

export function getCalendarInfo(): NonNullable<BadgeInfo> {
  return {
    title: "Google Calendar",
    label: "GCal",
    description: "Google Calendarへ登録済みの予定です。Calendar側の変更は同期時にCGMPへ反映されます。",
  };
}

export const ACTION_SYMBOLS: Record<CGMPAction, string> = {
  note: "📝",
  reminder: "✅",
  calendar: "📅",
  unclear: "❓",
};

export const DOMAIN_SYMBOLS: Record<Exclude<CGMPDomain, "">, string> = {
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

export const DOMAIN_FILTER_OPTIONS: Array<{ value: Exclude<CGMPDomain, "">; label: string }> = [
  { value: "work", label: "work" },
  { value: "life_admin", label: "admin" },
  { value: "family", label: "fam" },
  { value: "self", label: "self" },
  { value: "health", label: "hlth" },
  { value: "finance", label: "fin" },
  { value: "learning", label: "learn" },
  { value: "creation", label: "make" },
  { value: "other", label: "other" },
];

export const WEEKDAY_LABELS = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
export const WEEKDAY_MINI_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getMondayOfWeek(date: Date) {
  const base = startOfDay(date);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(base, diff);
}

export function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatWeekDate(date: Date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatWeekRange(start: Date) {
  return `${formatWeekDate(start)} - ${formatWeekDate(addDays(start, 6))}`;
}

export function getJstParts(value: string) {
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

export function minutesFromTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getRecordTimeline(record: CGMPRecord) {
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

export function getExternalSyncWindow(settings?: CGMPSettings | null) {
  const pastDays = Math.max(0, Math.round(Number(settings?.external_sync_past_days ?? 7)));
  const futureDays = Math.max(0, Math.round(Number(settings?.external_sync_future_days ?? 60)));
  const today = startOfDay(new Date());
  return {
    startKey: dateKeyFromDate(addDays(today, -pastDays)),
    endKey: dateKeyFromDate(addDays(today, futureDays)),
    pastDays,
    futureDays,
  };
}

export function getCalendarEndTime(record: CGMPRecord) {
  if (!record.date) return Number.NaN;
  const start = new Date(`${record.date}T${record.time || "00:00"}:00`);
  if (!Number.isFinite(start.getTime())) return Number.NaN;
  if (record.all_day) return addDays(startOfDay(start), 1).getTime();
  const duration = Number.isFinite(record.duration_minutes) && record.duration_minutes > 0 ? record.duration_minutes : 60;
  return start.getTime() + duration * 60 * 1000;
}

export function isRecordInExternalSyncRange(record: CGMPRecord, settings?: CGMPSettings | null) {
  const { startKey, endKey } = getExternalSyncWindow(settings);
  if (!record.date) {
    // Undated active Tasks still need polling so Google-side due dates can be pulled back into CGMP.
    return Boolean(record.google_task_id && record.google_task_status !== "completed");
  }
  return record.date >= startKey && record.date <= endKey;
}

export function shouldSyncExternalRecord(record: CGMPRecord, settings?: CGMPSettings | null) {
  const hasTask = Boolean(record.google_task_id && record.google_task_list_id);
  const hasCalendar = Boolean(record.google_calendar_event_id && record.google_calendar_id);
  if (!hasTask && !hasCalendar) return false;

  if (
    hasTask &&
    !hasCalendar &&
    settings?.external_sync_exclude_completed_tasks !== false &&
    record.google_task_status === "completed"
  ) {
    return false;
  }

  if (!isRecordInExternalSyncRange(record, settings)) return false;

  if (hasCalendar && settings?.external_sync_exclude_ended_calendar === true) {
    const endedAt = getCalendarEndTime(record);
    if (Number.isFinite(endedAt) && endedAt < Date.now()) return false;
  }

  return true;
}

export function getActionSymbol(record: CGMPRecord) {
  if ((record.attachments || []).some((attachment) => attachment.type === "image")) return "🖼️";
  return ACTION_SYMBOLS[record.action || "note"] || ACTION_SYMBOLS.note;
}

export function getDomainSymbol(domain: CGMPDomain | string) {
  const normalized = normalizeDomain(domain);
  return DOMAIN_SYMBOLS[(normalized || "other") as Exclude<CGMPDomain, "">] || DOMAIN_SYMBOLS.other;
}

export function scrollToElementById(id: string, block: ScrollLogicalPosition = "start") {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block });
}

export function normalizeSemanticThreshold(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return SEMANTIC_CANDIDATE_THRESHOLD;
  return Math.min(1, Math.max(-1, number));
}

