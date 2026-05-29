import type { CGMPAnalysis, CGMPAnalysisResponse, CGMPAction, CGMPDomain, CGMPPara, CGMPRecord } from "./types";

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `cgmp_${Math.random().toString(36).slice(2, 10)}`;
}

export function getNowStamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    iso: now.toISOString(),
    dateTime: `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`,
    dateKey: `${map.year}-${map.month}-${map.day}`,
    timeKey: `${map.hour}:${map.minute}`,
  };
}

export function formatJstDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatJstCompactDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

export function formatJstDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatJstTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.hour}:${map.minute}`;
}

export function makePreviewTitle(content: string, maxLength = 34) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled";
  return normalized.slice(0, maxLength).trim() || "Untitled";
}

export function parseTags(value: string | string[]) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => String(item || "").trim().replace(/^#+/, ""))
          .filter(Boolean)
      )
    ).slice(0, 24);
  }

  return Array.from(
    new Set(
      String(value || "")
        .split(/[\s,，、]+/)
        .map((item) => item.trim().replace(/^#+/, ""))
        .filter(Boolean)
    )
  ).slice(0, 24);
}

export function tagsToHashtags(tags: string[]) {
  return parseTags(tags).map((tag) => `#${tag}`);
}

export function normalizeAction(value: unknown): CGMPAction {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "note" || normalized === "reminder" || normalized === "calendar" || normalized === "unclear") {
    return normalized;
  }
  return "unclear";
}

export function normalizePara(value: unknown): CGMPPara {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "project" || normalized === "area" || normalized === "resource" || normalized === "archive") {
    return normalized;
  }
  return "";
}

export function normalizeDomain(value: unknown): CGMPDomain {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "work" ||
    normalized === "family" ||
    normalized === "self" ||
    normalized === "health" ||
    normalized === "finance" ||
    normalized === "learning" ||
    normalized === "creation" ||
    normalized === "life_admin" ||
    normalized === "other"
  ) {
    return normalized;
  }
  return "";
}

export function normalizeDuration(value: unknown, fallback = 60) {
  const duration = Number(value);
  if (Number.isFinite(duration) && duration > 0) {
    return Math.round(duration);
  }
  return fallback;
}

export function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function isTimeKey(value: string) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

export function normalizeDate(value: unknown, fallback = "") {
  const text = String(value || "").trim();
  return isDateKey(text) ? text : fallback;
}

export function normalizeTime(value: unknown, fallback = "") {
  const text = String(value || "").trim();
  return isTimeKey(text) ? text : fallback;
}

export function buildRecordFromAnalysis({
  analysis,
  rawInput,
  existingId,
  existingCreatedAt,
  aiMeta,
}: {
  analysis: CGMPAnalysis;
  rawInput: string;
  existingId?: string;
  existingCreatedAt?: string;
  aiMeta: { model: string; generated_at: string };
}): CGMPRecord {
  const stamp = getNowStamp();
  const createdAt = existingCreatedAt || stamp.iso;
  const allDay = Boolean(analysis.all_day);
  const action = normalizeAction(analysis.action);
  const date = normalizeDate(analysis.date, "");
  const time = normalizeTime(analysis.time, "");
  const tags = Array.isArray(analysis.tags) ? parseTags(analysis.tags) : parseTags(analysis.note_tags);

  return {
    schema_version: 1,
    id: existingId || createId(),
    created_at: createdAt,
    updated_at: stamp.iso,
    raw_input: rawInput,
    title: analysis.title || "（無題）",
    summary: analysis.summary || analysis.user_intent_summary || "",
    body: analysis.body || rawInput,
    action,
    tags,
    para: normalizePara(analysis.para),
    domain: normalizeDomain(analysis.domain),
    date,
    time,
    all_day: allDay,
    duration_minutes: normalizeDuration(analysis.duration_minutes, 60),
    location: analysis.location || "",
    confirmation: analysis.confirmation || "",
    note_tags: analysis.note_tags || tagsToHashtags(tags).join(" "),
    note_index_line: analysis.note_index_line || "",
    user_intent_summary: analysis.user_intent_summary || analysis.summary || "",
    ai_status: "done",
    ai_error: "",
    external_action_status: "none",
    external_target: "",
    external_registered_at: "",
    backup_status: "pending_backup",
    backup_retry_count: 0,
    backup_last_error: "",
    backup_next_retry_at: "",
    drive_file_id: "",
    last_backup_at: "",
    backup_checksum: "",
    ai: {
      model: aiMeta.model,
      generated_at: aiMeta.generated_at,
      initial_title: analysis.title || "",
      initial_tags: tags,
      initial_date: date,
      initial_time: time,
      initial_action: action,
      initial_para: normalizePara(analysis.para),
      initial_domain: normalizeDomain(analysis.domain),
      initial_summary: analysis.summary || analysis.user_intent_summary || "",
    },
  };
}

export function serializeAnalysisResponse(payload: CGMPAnalysisResponse) {
  return JSON.stringify(payload, null, 2);
}
