"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  clearAllRecords,
  deleteRecord,
  loadAllRecords,
  loadSettings,
  saveSettings,
  upsertRecord,
} from "@/lib/cgmp/storage";
import { getBackupStatus, importMissingRecordsFromDrive, processBackupQueue } from "@/lib/cgmp/backup";
import type {
  CGMPAction,
  CGMPAnalysisResponse,
  CGMPBackupSummary,
  CGMPDomain,
  CGMPPara,
  CGMPRecord,
  CGMPSettings,
} from "@/lib/cgmp/types";
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
import type { ReactNode, RefObject } from "react";

type AppTab = "home" | "compose" | "settings";
type SortKey = "updated_at" | "datetime";
type Notice = { kind: "info" | "error"; text: string } | null;
type DriveBackupRecordPreview = {
  id: string;
  title: string;
  summary: string;
  action: string;
  domain: string;
  para: string;
  updated_at: string;
  backed_up_at: string;
  checksum: string;
  file_id: string;
  record?: Partial<CGMPRecord>;
  error?: boolean;
};

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
  "mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15";
const textareaClass = `${fieldClass} min-h-[120px] resize-y`;
const panelClass =
  "rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(5,13,24,0.96),rgba(3,8,16,0.96))] p-5 shadow-[0_0_0_1px_rgba(148,163,184,0.05),0_28px_80px_rgba(0,0,0,0.35)]";
const softPanelClass =
  "rounded-[24px] border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]";
const primaryButtonClass =
  "rounded-2xl border border-cyan-400/30 bg-cyan-400/15 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:border-cyan-300/60 hover:bg-cyan-400/25";
const secondaryButtonClass =
  "rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-white/20 hover:bg-white/10";
const dangerButtonClass =
  "rounded-2xl border border-rose-400/30 bg-rose-400/15 px-4 py-2.5 text-sm font-medium text-rose-50 transition hover:border-rose-300/60 hover:bg-rose-400/25";

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
    backup_status: existing?.backup_status ?? "pending_backup",
    backup_retry_count: existing?.backup_retry_count ?? 0,
    backup_last_error: existing?.backup_last_error ?? "",
    backup_next_retry_at: existing?.backup_next_retry_at ?? "",
    drive_file_id: existing?.drive_file_id ?? "",
    last_backup_at: existing?.last_backup_at ?? "",
    backup_checksum: existing?.backup_checksum ?? "",
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
  ]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
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
  if (record.backup_status === "backed_up") return "バックアップ済み";
  if (record.backup_status === "backing_up") return "バックアップ中";
  if (record.backup_status === "pending_backup") return "バックアップ待ち";
  if (record.backup_status === "backup_failed") return "バックアップ失敗";
  if (record.backup_status === "conflicted") return "競合";
  return "端末のみ";
}

function getBackupTone(record: CGMPRecord): "slate" | "cyan" | "emerald" | "amber" | "rose" {
  if (record.backup_status === "backed_up") return "emerald";
  if (record.backup_status === "backing_up") return "cyan";
  if (record.backup_status === "pending_backup") return "amber";
  if (record.backup_status === "backup_failed" || record.backup_status === "conflicted") return "rose";
  return "slate";
}

function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "cyan" | "emerald" | "amber" | "rose";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
      : tone === "emerald"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
        : tone === "amber"
          ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
          : tone === "rose"
            ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
            : "border-white/10 bg-white/5 text-zinc-100";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${toneClass}`}>
      {children}
    </span>
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
      <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-200/80">{eyebrow}</div>
      <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
      {description ? <p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p> : null}
    </div>
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
    <label className="block text-sm font-medium text-zinc-200">
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
    <label className="block text-sm font-medium text-zinc-200">
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
    <label className="block text-sm font-medium text-zinc-200">
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
    <label className="block text-sm font-medium text-zinc-200">
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
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-200">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full border transition ${
          value ? "border-cyan-400/60 bg-cyan-400/30" : "border-white/10 bg-white/10"
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
  isSelected = false,
}: {
  record: CGMPRecord;
  onOpen: (id: string) => void;
  isSelected?: boolean;
}) {
  const para = getEffectivePara(record);
  return (
    <button
      type="button"
      onClick={() => onOpen(record.id)}
      id={`record-card-${record.id}`}
      className="group w-full scroll-mt-24 text-left"
    >
      <div
        className={`rounded-[24px] border p-4 transition duration-300 ${
          isSelected
            ? "border-cyan-400/60 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
            : "border-white/10 bg-white/5 group-hover:border-cyan-400/30 group-hover:bg-white/[0.08]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={record.action === "calendar" ? "amber" : record.action === "reminder" ? "rose" : record.action === "unclear" ? "slate" : "cyan"}>
            {record.action}
          </Badge>
          <Badge tone="slate">{record.domain || "other"}</Badge>
          <Badge tone="slate">{para}</Badge>
          <Badge tone={getBackupTone(record)}>{getBackupLabel(record)}</Badge>
          <span className="text-xs text-zinc-500">{formatJstDateTime(record.updated_at)}</span>
        </div>

        <div className="mt-3">
          <h3 className="text-base font-semibold text-white">{record.title || "（無題）"}</h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-300">
            {record.summary || record.body || record.raw_input}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(record.tags || []).slice(0, 5).map((tag) => (
            <Badge key={tag}>{`#${tag}`}</Badge>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
          <span>{record.date || "未設定日付"}</span>
          <span>{record.time || "未設定時刻"}</span>
          <span>{record.external_action_status}</span>
          {record.last_backup_at ? <span>backup {formatJstDateTime(record.last_backup_at)}</span> : null}
        </div>

        <div
          className={`overflow-hidden transition-[height,opacity,margin-top] duration-300 ease-out ${
            isSelected
              ? "mt-4 h-52 opacity-100 sm:h-56"
              : "mt-0 h-0 opacity-0 group-focus-visible:mt-4 group-focus-visible:h-52 group-focus-visible:opacity-100 sm:group-focus-visible:h-56"
          }`}
        >
          <div className="h-full rounded-2xl border border-cyan-400/20 bg-black/30 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/70">原文</div>
            <div className="mt-2 h-[calc(100%-1.5rem)] overflow-auto overscroll-contain pr-1">
              <pre className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-100">
                {record.raw_input || record.summary || record.body || "（原文なし）"}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </button>
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
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-cyan-400/30 hover:bg-white/[0.08]">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span>{record.updated_at ? formatJstDateTime(record.updated_at) : "未設定"}</span>
          <span>/</span>
          <span>{record.action || "note"}</span>
        </div>
        <div className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-zinc-50">
          {record.title || "（無題）"}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">
          {record.summary || record.raw_input || ""}
        </p>
      </div>
    </button>
  );
}

export default function Page() {
  const [tab, setTab] = useState<AppTab>("home");
  const [records, setRecords] = useState<CGMPRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | CGMPAction>("all");
  const [domainFilter, setDomainFilter] = useState<"all" | CGMPDomain>("all");
  const [paraFilter, setParaFilter] = useState<"all" | CGMPPara>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [composeDraft, setComposeDraft] = useState<RecordFormState>(() => blankForm(""));
  const [composeAiStatus, setComposeAiStatus] = useState<CGMPRecord["ai_status"]>("none");
  const [composeAiError, setComposeAiError] = useState("");
  const [composeAiMeta, setComposeAiMeta] = useState<{ model: string; generated_at: string } | null>(null);
  const [composeLoading, setComposeLoading] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<CGMPSettings | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [detailDraft, setDetailDraft] = useState<RecordFormState | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailDeleting, setDetailDeleting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const composeRawInputRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmSectionRef = useRef<HTMLElement | null>(null);
  const [composeFocusTick, setComposeFocusTick] = useState(0);
  const [isMiniListOpen, setIsMiniListOpen] = useState(false);
  const [miniListQuery, setMiniListQuery] = useState("");
  const [pendingMiniJumpId, setPendingMiniJumpId] = useState<string | null>(null);
  const [backupSummary, setBackupSummary] = useState<CGMPBackupSummary | null>(null);
  const [backupProcessing, setBackupProcessing] = useState(false);
  const [driveBackupLoading, setDriveBackupLoading] = useState(false);
  const [driveImporting, setDriveImporting] = useState(false);
  const [driveBackupRecords, setDriveBackupRecords] = useState<DriveBackupRecordPreview[] | null>(null);
  const [driveBackupCheckedAt, setDriveBackupCheckedAt] = useState("");
  const initialDriveImportDoneRef = useRef(false);

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

  async function runBackupQueue(showNotice = false) {
    if (backupProcessing) return;
    setBackupProcessing(true);
    try {
      const results = await processBackupQueue();
      await Promise.all([reloadRecords(), reloadBackupSummary()]);
      const failed = results.filter((result) => !result.ok).length;
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
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "バックアップに失敗しました",
        });
      }
    } finally {
      setBackupProcessing(false);
    }
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
      setDriveBackupRecords(Array.isArray(payload.records) ? payload.records : []);
      setDriveBackupCheckedAt(new Date().toISOString());
      setNotice({ kind: "info", text: "Drive上のバックアップ一覧を取得しました。" });
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
      await Promise.all([reloadRecords(), reloadBackupSummary()]);
      if (showNotice || result.imported.length > 0) {
        setNotice({
          kind: "info",
          text:
            result.imported.length > 0
              ? `Driveから未取り込みメモを${result.imported.length}件追加しました。`
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextRecords, nextSettings, nextBackupSummary] = await Promise.all([
          loadAllRecords(),
          loadSettings(),
          getBackupStatus(),
        ]);
        if (cancelled) return;
        setRecords(nextRecords);
        setSettingsDraft(nextSettings);
        setBackupSummary(nextBackupSummary);
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
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    if (!initialDriveImportDoneRef.current) {
      initialDriveImportDoneRef.current = true;
      void importMissingFromDrive(false);
    }
    void runBackupQueue(false);

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void runBackupQueue(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, [isReady]);

  const filteredRecords = useMemo(() => {
    const tagged = records.filter((record) => {
      const textOk = matchesQuery(record, query, tagQuery);
      const actionOk = actionFilter === "all" || record.action === actionFilter;
      const domainOk = domainFilter === "all" || record.domain === domainFilter;
      const paraOk = paraFilter === "all" || getEffectivePara(record) === paraFilter;
      return textOk && actionOk && domainOk && paraOk;
    });

    return tagged.sort((a, b) => {
      if (sortKey === "datetime") {
        const aValue = getDateSortValue(a);
        const bValue = getDateSortValue(b);
        if (aValue === bValue) return String(b.id).localeCompare(String(a.id));
        return bValue - aValue;
      }

      const aValue = new Date(a.updated_at || a.created_at).getTime();
      const bValue = new Date(b.updated_at || b.created_at).getTime();
      if (aValue === bValue) return String(b.id).localeCompare(String(a.id));
      return bValue - aValue;
    });
  }, [records, query, tagQuery, actionFilter, domainFilter, paraFilter, sortKey]);

  const selectedRecord = useMemo(() => records.find((record) => record.id === selectedId) ?? null, [records, selectedId]);
  const miniFilteredRecords = useMemo(() => {
    return records.filter((record) => matchesMiniQuery(record, miniListQuery));
  }, [records, miniListQuery]);

  async function handleAnalyze() {
    const rawInput = composeDraft.raw_input.trim();
    if (!rawInput) {
      setNotice({ kind: "error", text: "入力テキストを入れてください。" });
      return;
    }

    setComposeLoading(true);
    setComposeAiError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: rawInput,
          input_at: new Date().toISOString(),
          model: settingsDraft?.openai_model || "gpt-4.1-nano",
        }),
      });

      const payload = (await response.json()) as CGMPAnalysisResponse & { detail?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || payload.detail || "AI解析に失敗しました");
      }

      const analysis = payload.result;
      setComposeDraft((prev) => ({
        ...prev,
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
      }));
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
    } finally {
      setComposeLoading(false);
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

  async function saveDetail() {
    if (!selectedRecord || !detailDraft) return;
    setDetailSaving(true);
    try {
      const nextRecord = formToRecord(detailDraft, { existing: selectedRecord });
      await upsertRecord(nextRecord);
      await reloadRecords(nextRecord.id);
      await reloadBackupSummary();
      setNotice({ kind: "info", text: "更新しました。" });
      window.setTimeout(() => {
        void runBackupQueue(false);
      }, 0);
      setReloadTick((value) => value + 1);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "更新に失敗しました",
      });
    } finally {
      setDetailSaving(false);
    }
  }

  async function deleteSelected() {
    if (!selectedRecord) return;
    const confirmed = window.confirm(`「${selectedRecord.title || "（無題）"}」を削除しますか？`);
    if (!confirmed) return;

    setDetailDeleting(true);
    try {
      await deleteRecord(selectedRecord.id);
      await reloadRecords();
      await reloadBackupSummary();
      setSelectedId((current) => {
        const remaining = records.filter((record) => record.id !== selectedRecord.id);
        return remaining.find((record) => record.id === current)?.id ?? remaining[0]?.id ?? null;
      });
      setNotice({ kind: "info", text: "削除しました。" });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "削除に失敗しました",
      });
    } finally {
      setDetailDeleting(false);
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

  async function handleClearAll() {
    const confirmed = window.confirm("全ての記録を削除しますか？ この操作は戻せません。");
    if (!confirmed) return;
    await clearAllRecords();
    await reloadRecords();
    await reloadBackupSummary();
    setSelectedId(null);
    setNotice({ kind: "info", text: "全件削除しました。" });
  }

  if (!isReady) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_transparent_36%),linear-gradient(180deg,#020617_0%,#040b17_40%,#020617_100%)] px-6 py-10 text-zinc-100">
        <div className="mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center">
          <div className={panelClass}>
            <p className="text-sm uppercase tracking-[0.4em] text-cyan-200/80">CGMP PWA</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">読み込み中...</h1>
            <p className="mt-2 text-zinc-400">IndexedDB と設定を確認しています。</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_transparent_36%),linear-gradient(180deg,#020617_0%,#040b17_40%,#020617_100%)] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-4 pb-28 sm:px-6 lg:px-8">
        {notice ? (
          <div
            className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
              notice.kind === "info"
                ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-50"
                : "border-rose-400/20 bg-rose-400/10 text-rose-50"
            }`}
          >
            {notice.text}
          </div>
        ) : null}

        {tab === "home" ? (
          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <section className={panelClass}>
              <SectionHeading
                eyebrow="Home"
                title="一覧・検索・フィルター"
                description="CGMP の核になる検索面です。テキスト、タグ、action, domain, PARA で絞り込めます。"
              />

              <div className="grid grid-cols-2 gap-3">
                <LabeledInput label="Text search" value={query} onChange={setQuery} placeholder="title / summary / body / raw_input" />
                <LabeledInput label="Tag search" value={tagQuery} onChange={setTagQuery} placeholder="例: 仕様" />
              </div>

              <div className="mt-3 grid grid-cols-4 gap-3">
                <LabeledSelect
                  label="Action"
                  value={actionFilter}
                  onChange={(value) => setActionFilter(value === "all" ? "all" : normalizeAction(value))}
                  options={[
                    { value: "all", label: "all" },
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
                    { value: "all", label: "all" },
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
                    { value: "all", label: "all" },
                    { value: "project", label: "project" },
                    { value: "area", label: "area" },
                    { value: "resource", label: "resource" },
                    { value: "archive", label: "archive" },
                  ]}
                />
                <LabeledSelect
                  label="Sort"
                  value={sortKey}
                  onChange={(value) => setSortKey(value === "datetime" ? "datetime" : "updated_at")}
                  options={[
                    { value: "updated_at", label: "updated_at" },
                    { value: "datetime", label: "date/time" },
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
                }} className={secondaryButtonClass}>
                  クリア
                </button>
                <button type="button" onClick={() => setTab("compose")} className={primaryButtonClass}>
                  新規入力へ
                </button>
              </div>

              <div className="mt-5 grid gap-3">
                {filteredRecords.length > 0 ? (
                  filteredRecords.map((record) => (
                    <RecordCard
                      key={record.id}
                      record={record}
                      onOpen={(id) => setSelectedId((current) => (current === id ? null : id))}
                      isSelected={record.id === selectedId}
                    />
                  ))
                ) : (
                  <div className={`${softPanelClass} text-sm text-zinc-400`}>
                    条件に一致する記録がありません。まずは Compose で1件保存してみてください。
                  </div>
                )}
              </div>
            </section>

            <aside className={panelClass}>
              <SectionHeading
                eyebrow="Detail"
                title={selectedRecord ? selectedRecord.title || "（無題）" : "記録を選択"}
                description="選択した record を確認・修正します。"
              />

              {selectedRecord && detailDraft ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={selectedRecord.action === "calendar" ? "amber" : selectedRecord.action === "reminder" ? "rose" : "cyan"}>
                      {selectedRecord.action}
                    </Badge>
                    <Badge>{selectedRecord.domain || "other"}</Badge>
                    <Badge>{getEffectivePara(selectedRecord)}</Badge>
                    <span className="text-xs text-zinc-500">updated {formatJstDateTime(selectedRecord.updated_at)}</span>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Preview</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                      {selectedRecord.summary || selectedRecord.body || selectedRecord.raw_input}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(selectedRecord.tags || []).map((tag) => (
                        <Badge key={tag}>#{tag}</Badge>
                      ))}
                    </div>
                  </div>

                  <RecordEditor
                    draft={detailDraft}
                    onChange={(patch) => setDetailDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
                    showRawInput
                  />

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={saveDetail} disabled={detailSaving} className={primaryButtonClass}>
                      {detailSaving ? "保存中..." : "保存"}
                    </button>
                    <button type="button" onClick={() => setSelectedId(null)} className={secondaryButtonClass}>
                      閉じる
                    </button>
                    <button type="button" onClick={deleteSelected} disabled={detailDeleting} className={dangerButtonClass}>
                      {detailDeleting ? "削除中..." : "削除"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={softPanelClass}>
                  <p className="text-sm leading-6 text-zinc-300">
                    一覧のカードを選ぶと、ここで詳細の確認と編集ができます。`Compose` で作った record もすぐここに出ます。
                  </p>
                </div>
              )}
            </aside>
          </div>
        ) : null}

        {tab === "compose" ? (
          <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <section className={panelClass}>
              <SectionHeading
                eyebrow="Compose"
                title="入力 → AI解析 → 確認"
                description="MVP の中核。まずは雑に入れて、AIが構造化した結果を手で直して保存します。"
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
                  <div className="text-sm font-medium text-zinc-100">AI状態</div>
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
              <SectionHeading
                eyebrow="Confirm"
                title="AI結果の確認・修正"
                description="保存前にここで action, date, title, tags などを微調整します。"
              />

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
          <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <section className={panelClass}>
              <SectionHeading
                eyebrow="Settings"
                title="PWA と AI の設定"
                description="MVP では最小限。OpenAI モデルとタイムゾーンだけをまず持たせます。"
              />

              <div className="space-y-4">
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
                <div className={softPanelClass}>
                  <p className="text-sm leading-6 text-zinc-300">
                    Vercel では `OPENAI_API_KEY` と Google Drive 用の環境変数を設定してください。クライアント側には渡しません。
                  </p>
                </div>
                <div className={softPanelClass}>
                  <div className="text-sm font-medium text-zinc-100">Google Drive バックアップ</div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs text-zinc-300">
                    <div>
                      <dt className="text-zinc-500">未バックアップ</dt>
                      <dd className="mt-1 text-lg font-semibold text-amber-100">{backupSummary ? backupSummary.localOnly + backupSummary.pending : "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">バックアップ中</dt>
                      <dd className="mt-1 text-lg font-semibold text-cyan-100">{backupSummary?.backingUp ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">失敗</dt>
                      <dd className="mt-1 text-lg font-semibold text-rose-100">{backupSummary?.failed ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">最終バックアップ</dt>
                      <dd className="mt-1 text-sm text-zinc-100">
                        {backupSummary?.lastBackupAt ? formatJstDateTime(backupSummary.lastBackupAt) : "未実行"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => runBackupQueue(true)} disabled={backupProcessing} className={primaryButtonClass}>
                      {backupProcessing ? "処理中..." : "今すぐバックアップ"}
                    </button>
                    <button type="button" onClick={loadDriveBackupList} disabled={driveBackupLoading} className={secondaryButtonClass}>
                      {driveBackupLoading ? "確認中..." : "Drive上の一覧を確認"}
                    </button>
                    <button type="button" onClick={() => importMissingFromDrive(true)} disabled={driveImporting} className={secondaryButtonClass}>
                      {driveImporting ? "取り込み中..." : "未取り込みを追加"}
                    </button>
                    <a href="/api/auth/google/start" className={secondaryButtonClass}>
                      Google Driveを認可
                    </a>
                  </div>
                </div>
                {driveBackupRecords ? (
                  <div className={softPanelClass}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-zinc-100">Drive上に実在するバックアップ</div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {driveBackupCheckedAt ? `${formatJstDateTime(driveBackupCheckedAt)} に確認` : ""}
                        </p>
                      </div>
                      <Badge tone="emerald">{driveBackupRecords.length}件</Badge>
                    </div>
                    <div className="mt-4 max-h-80 space-y-2 overflow-auto pr-1">
                      {driveBackupRecords.length > 0 ? (
                        driveBackupRecords.map((backup) => (
                          <div
                            key={`${backup.id}:${backup.file_id}`}
                            className={`rounded-2xl border p-3 ${
                              backup.error ? "border-rose-400/20 bg-rose-400/10" : "border-white/10 bg-black/20"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                              <Badge tone={backup.error ? "rose" : "emerald"}>{backup.error ? "読込失敗" : "実在確認済み"}</Badge>
                              <span>{backup.action || "note"}</span>
                              <span>{backup.domain || "other"}</span>
                              <span>{backup.para || "area"}</span>
                            </div>
                            <div className="mt-2 text-sm font-semibold text-zinc-50">{backup.title || "（無題）"}</div>
                            {backup.summary ? (
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{backup.summary}</p>
                            ) : null}
                            <div className="mt-3 grid gap-1 text-[11px] text-zinc-500">
                              <span>backup: {backup.backed_up_at ? formatJstDateTime(backup.backed_up_at) : "不明"}</span>
                              <span>record: {backup.id}</span>
                              <span>file: {backup.file_id}</span>
                              <span>checksum: {backup.checksum.slice(0, 16)}...</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-zinc-400">Drive上のバックアップはまだありません。</p>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleSaveSettings} disabled={settingsSaving} className={primaryButtonClass}>
                    {settingsSaving ? "保存中..." : "設定を保存"}
                  </button>
                  <button type="button" onClick={() => reloadSettings()} className={secondaryButtonClass}>
                    再読み込み
                  </button>
                  <button type="button" onClick={handleClearAll} className={dangerButtonClass}>
                    全削除
                  </button>
                </div>
              </div>
            </section>

            <aside className={panelClass}>
              <SectionHeading eyebrow="Manifest" title="PWA 対応の状態" description="manifest を置いて standalone 起動を有効化しています。" />
              <div className={softPanelClass}>
                <ul className="space-y-2 text-sm leading-6 text-zinc-300">
                  <li>・Home / Compose / Settings の3画面構成</li>
                  <li>・IndexedDB に record を保存</li>
                  <li>・/api/analyze で OpenAI 解析</li>
                  <li>・詳細編集と削除を実装</li>
                </ul>
              </div>
            </aside>
          </div>
        ) : null}
      </div>

      <div className="fixed bottom-24 right-5 z-50 flex flex-col items-end gap-3 sm:right-6">
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
          className="flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-400/20 text-2xl font-semibold text-cyan-50 shadow-[0_24px_60px_rgba(34,211,238,0.22)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-cyan-400/30 hover:shadow-[0_28px_70px_rgba(34,211,238,0.28)] sm:h-16 sm:w-16"
          aria-label="新規メモを作成"
          title="新規メモを作成"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => setIsMiniListOpen((value) => !value)}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[26px] font-semibold text-white shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/15 sm:h-16 sm:w-16"
          aria-label="縮小メモ一覧を開く"
          title="縮小メモ一覧"
        >
          {isMiniListOpen ? "×" : "☰"}
        </button>
      </div>

      {isMiniListOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setIsMiniListOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,420px)] flex-col border-l border-white/10 bg-[rgba(6,13,24,0.98)] shadow-[0_0_0_1px_rgba(255,255,255,0.02),-24px_0_80px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.34em] text-cyan-200/70">Mini List</div>
                <h2 className="mt-1 text-lg font-semibold text-white">縮小メモ一覧</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsMiniListOpen(false)}
                className={secondaryButtonClass}
              >
                閉じる
              </button>
            </div>

            <div className="border-b border-white/10 px-5 py-4">
              <label className="block text-sm font-medium text-zinc-200">
                全文検索
                <input
                  value={miniListQuery}
                  onChange={(event) => setMiniListQuery(event.target.value)}
                  placeholder="タイトル / 要約 / タグ / 原文"
                  className={fieldClass}
                />
              </label>
              <div className="mt-3 text-xs text-zinc-500">
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
                    <p className="text-sm leading-6 text-zinc-400">
                      条件に一致する記録がありません。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[rgba(2,6,23,0.82)] px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto grid max-w-3xl grid-cols-3 gap-2">
          {[
            { key: "home", label: "Home" },
            { key: "compose", label: "Compose" },
            { key: "settings", label: "Settings" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key as AppTab)}
              className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                tab === item.key
                  ? "bg-cyan-400/15 text-cyan-50"
                  : "bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
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
