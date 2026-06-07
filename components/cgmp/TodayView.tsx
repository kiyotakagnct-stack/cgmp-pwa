"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";

import { ImageAttachmentGrid } from "@/components/ImageAttachmentGrid";
import { Badge, getDomainColorVar, panelClass } from "@/components/cgmp/ui";
import {
  addDays,
  dateKeyFromDate,
  formatWeekDate,
  getDomainSymbol,
  getJstParts,
  getRecordTimeline,
  minutesFromTime,
  shouldSyncExternalRecord,
  startOfDay,
  WEEKDAY_LABELS,
} from "@/lib/cgmp/client-utils";
import { getRecordSemanticIcon } from "@/lib/cgmp/semantic-icons";
import type { CGMPRecord, CGMPSettings } from "@/lib/cgmp/types";
import type { ImageAttachment } from "@/types/image";

type LoadLabel = "Light" | "Moderate" | "Heavy";
type FlowKind = "record" | "now";

type TodayFlowItem = {
  id: string;
  kind: FlowKind;
  record?: CGMPRecord;
  timeLabel: string;
  sortValue: number;
  icon: string;
  title: string;
  summary: string;
  statusLabel: string;
  statusTone: "cyan" | "emerald" | "amber" | "rose" | "slate";
};

type TimelineItem = TodayFlowItem & {
  position: number;
  color: string;
};

type UnprocessedReason = {
  label: string;
  tone: "cyan" | "emerald" | "amber" | "rose" | "slate";
};

const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 24 * 60;
const TIMELINE_RANGE = DAY_END_MINUTES - DAY_START_MINUTES;

function recordSummary(record: CGMPRecord) {
  return record.summary || record.user_intent_summary || record.body || record.raw_input || "";
}

function inferSemanticIcon(record: CGMPRecord) {
  return getRecordSemanticIcon(record);
}

function isTask(record: CGMPRecord) {
  return record.action === "reminder";
}

function isIncompleteTask(record: CGMPRecord) {
  return isTask(record) && record.google_task_status !== "completed";
}

function isGoogleTaskLinked(record: CGMPRecord) {
  return (
    record.external_action_status === "registered" &&
    record.google_task_status === "needsAction" &&
    Boolean(String(record.google_task_id || "").trim()) &&
    Boolean(String(record.google_task_list_id || "").trim())
  );
}

function createdDateKey(record: CGMPRecord) {
  return getJstParts(record.created_at || record.updated_at).dateKey;
}

function isCreatedToday(record: CGMPRecord, todayKey: string) {
  if (!record.created_at) return false;
  return getJstParts(record.created_at).dateKey === todayKey;
}

function createdTimeLabel(record: CGMPRecord) {
  if (!record.created_at) return "";
  const parts = getJstParts(record.created_at);
  return parts.time;
}

function booleanMeta(record: CGMPRecord, key: string) {
  return Boolean((record as CGMPRecord & Record<string, unknown>)[key]);
}

function stringMeta(record: CGMPRecord, key: string) {
  const value = (record as CGMPRecord & Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function getUnprocessedReason(record: CGMPRecord): UnprocessedReason | null {
  if (record.action === "unclear") return { label: "action確認", tone: "amber" };
  if (booleanMeta(record, "pending_ai") || record.ai_status === "pending_ai") return { label: "AI待ち", tone: "amber" };
  if (record.ai_status === "error" || record.ai_status === "timeout") return { label: "AI失敗", tone: "rose" };
  if (booleanMeta(record, "needsReview") || stringMeta(record, "confirmationStatus") === "pending") {
    return { label: "確認待ち", tone: "amber" };
  }
  if (record.external_action_status === "pending_confirmation") return { label: "確認待ち", tone: "amber" };
  if (record.external_action_status === "failed") return { label: "登録失敗", tone: "rose" };
  if (record.action === "calendar" && record.external_action_status === "registered" && !record.google_calendar_event_id) {
    return { label: "Calendar確認", tone: "amber" };
  }
  if (record.action === "reminder" && record.external_action_status === "registered" && !record.google_task_id) {
    return { label: "Task確認", tone: "amber" };
  }
  if (record.backup_status === "backup_failed" || record.backup_status === "conflicted" || booleanMeta(record, "sync_error")) {
    return { label: "同期失敗", tone: "rose" };
  }
  if (
    record.backup_status === "pending_backup" ||
    record.backup_status === "backing_up" ||
    booleanMeta(record, "pending_sync")
  ) {
    return { label: "同期待ち", tone: "cyan" };
  }

  const attachments = record.attachments || [];
  const failedAttachment = attachments.find(
    (attachment) =>
      attachment.analysis_status === "failed" ||
      attachment.backup_status === "backup_failed" ||
      attachment.backup_status === "conflicted" ||
      attachment.blob_upload_status === "backup_failed" ||
      attachment.blob_upload_status === "conflicted"
  );
  if (failedAttachment) {
    return failedAttachment.analysis_status === "failed"
      ? { label: "画像解析失敗", tone: "rose" }
      : { label: "写真同期失敗", tone: "rose" };
  }

  const pendingAttachment = attachments.find(
    (attachment) =>
      attachment.analysis_status === "pending" ||
      attachment.analysis_status === "analyzing" ||
      attachment.backup_status === "pending_backup" ||
      attachment.backup_status === "backing_up" ||
      attachment.blob_upload_status === "pending_backup" ||
      attachment.blob_upload_status === "backing_up"
  );
  if (pendingAttachment) {
    return pendingAttachment.analysis_status === "pending" || pendingAttachment.analysis_status === "analyzing"
      ? { label: "画像解析待ち", tone: "amber" }
      : { label: "写真同期待ち", tone: "cyan" };
  }

  if ((record.action === "calendar" || record.action === "reminder") && !record.date) {
    return { label: "日時確認", tone: "amber" };
  }

  return null;
}

function isUnprocessedRecord(record: CGMPRecord) {
  return Boolean(getUnprocessedReason(record));
}

function getTodaysInboxRecords(records: CGMPRecord[], todayKey: string) {
  return records
    .filter((record) => isCreatedToday(record, todayKey) && isUnprocessedRecord(record))
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function compareByTime(left: CGMPRecord, right: CGMPRecord) {
  const leftTimeline = getRecordTimeline(left);
  const rightTimeline = getRecordTimeline(right);
  if (leftTimeline.sortValue !== rightTimeline.sortValue) return leftTimeline.sortValue - rightTimeline.sortValue;
  return String(left.created_at || left.updated_at).localeCompare(String(right.created_at || right.updated_at));
}

function previousWeekdayBaseline(today: Date) {
  const normalized = startOfDay(today);
  const day = normalized.getDay();
  const monday =
    day === 0 || day === 6
      ? addDays(normalized, -(day === 0 ? 6 : 5))
      : addDays(normalized, -(day + 6));
  return Array.from({ length: 5 }, (_, index) => dateKeyFromDate(addDays(monday, index)));
}

function getTimeBandLabel(minutes: number) {
  if (minutes >= 5 * 60 && minutes < 10 * 60) return "朝の立ち上げ";
  if (minutes >= 10 * 60 && minutes < 12 * 60) return "午前の集中タイム";
  if (minutes >= 12 * 60 && minutes < 14 * 60) return "昼の調整時間";
  if (minutes >= 14 * 60 && minutes < 18 * 60) return "午後の実行時間";
  if (minutes >= 18 * 60 && minutes < 21 * 60) return "夕方の整理時間";
  return "夜の集中タイム";
}

function timelinePosition(minutes: number) {
  return Math.max(0, Math.min(100, ((minutes - DAY_START_MINUTES) / TIMELINE_RANGE) * 100));
}

function getRecordStatus(record: CGMPRecord) {
  if (record.action === "calendar") return { label: "予定", tone: "emerald" as const };
  if (record.action === "reminder") {
    return record.google_task_status === "completed"
      ? { label: "完了", tone: "emerald" as const }
      : { label: "未完了", tone: "amber" as const };
  }
  if (record.action === "note") return { label: "メモ", tone: "cyan" as const };
  return { label: "確認", tone: "slate" as const };
}

function buildFlowItem(record: CGMPRecord): TodayFlowItem {
  const timeline = getRecordTimeline(record);
  const status = getRecordStatus(record);
  return {
    id: record.id,
    kind: "record",
    record,
    timeLabel: timeline.timeLabel,
    sortValue: timeline.sortValue,
    icon: inferSemanticIcon(record),
    title: record.title || "（無題）",
    summary: recordSummary(record),
    statusLabel: status.label,
    statusTone: status.tone,
  };
}

function buildNowItem(nowMinutes: number, nowTimeLabel: string): TodayFlowItem {
  return {
    id: "today-now",
    kind: "now",
    timeLabel: nowTimeLabel,
    sortValue: nowMinutes,
    icon: "●",
    title: "現在時刻",
    summary: `${getTimeBandLabel(nowMinutes)}です。計画的に進めましょう。`,
    statusLabel: "NOW",
    statusTone: "cyan",
  };
}

function calculateLoad(records: CGMPRecord[], todayKey: string, today: Date) {
  const baselineKeys = previousWeekdayBaseline(today);
  const taskCountByDay = new Map<string, number>();
  for (const key of baselineKeys) taskCountByDay.set(key, 0);

  for (const record of records) {
    if (!isTask(record) || !record.date) continue;
    if (taskCountByDay.has(record.date)) taskCountByDay.set(record.date, (taskCountByDay.get(record.date) || 0) + 1);
  }

  const baselineTaskCount = baselineKeys.reduce((sum, key) => sum + (taskCountByDay.get(key) || 0), 0) / 5;
  const todayTaskCount = records.filter((record) => isTask(record) && record.date === todayKey).length;

  let label: LoadLabel;
  if (baselineTaskCount >= 1) {
    const ratio = todayTaskCount / baselineTaskCount;
    label = ratio <= 0.8 ? "Light" : ratio <= 1.4 ? "Moderate" : "Heavy";
  } else {
    label = todayTaskCount <= 1 ? "Light" : todayTaskCount <= 3 ? "Moderate" : "Heavy";
  }

  return {
    label,
    todayTaskCount,
    baselineTaskCount,
    subText: `${todayTaskCount}件 / 平均${baselineTaskCount.toFixed(1)}件`,
  };
}

function MiniMetric({ label, value, subText }: { label: string; value: string; subText?: string }) {
  return (
    <div className="min-w-0 border-l border-[color:var(--border)] pl-3 first:border-l-0 first:pl-0">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-[var(--text)]">{value}</div>
      {subText ? <div className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{subText}</div> : null}
    </div>
  );
}

function MissionRecordPreview({
  label,
  record,
  emptyTitle,
  emptySummary,
  compact = false,
}: {
  label: string;
  record: CGMPRecord | null;
  emptyTitle: string;
  emptySummary: string;
  compact?: boolean;
}) {
  const timeLabel = record ? getRecordTimeline(record).timeLabel : "";
  return (
    <div className="min-w-0 border-t border-[color:var(--border)] pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
        <span>{label}</span>
      </div>
      {record ? (
        <div className="mt-1 flex min-w-0 items-start gap-2">
          {!compact ? <span className="font-mono text-3xl font-semibold leading-none text-[var(--text)]">{timeLabel}</span> : null}
          <span className={`${compact ? "mt-0.5 text-lg" : "mt-1 text-2xl"} leading-none`}>{inferSemanticIcon(record)}</span>
          <div className="min-w-0">
            <div className={`${compact ? "text-sm" : "text-base"} truncate font-semibold text-[var(--text)]`}>{record.title || "（無題）"}</div>
            <div className="mt-0.5 line-clamp-1 text-xs leading-5 text-[var(--muted)]">{recordSummary(record)}</div>
          </div>
        </div>
      ) : (
        <div className="mt-1">
          <div className="text-sm font-semibold text-[var(--text)]">{emptyTitle}</div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">{emptySummary}</div>
        </div>
      )}
    </div>
  );
}

function DayTimeline({ items, nowMinutes }: { items: TimelineItem[]; nowMinutes: number }) {
  const nowPosition = timelinePosition(nowMinutes);
  const labels = [6, 9, 12, 15, 18, 21, 24];
  return (
    <section className={panelClass}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
        <span>◷</span>
        <span>Day Timeline</span>
      </div>
      <div className="mt-3 px-1">
        <div className="relative h-20">
          <div className="absolute left-0 right-0 top-7 h-1 rounded-full bg-[var(--border)]" />
          <div className="absolute left-0 right-0 top-7 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] via-[var(--success)] to-[var(--orange)] opacity-60" />
          {labels.map((hour) => (
            <div
              key={hour}
              className="absolute top-0 -translate-x-1/2 text-[11px] text-[var(--muted)]"
              style={{ left: `${timelinePosition(hour * 60)}%` }}
            >
              {hour === 24 ? "24" : String(hour).padStart(2, "0")}
            </div>
          ))}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="absolute top-[18px] flex -translate-x-1/2 flex-col items-center gap-0.5"
              style={{ left: `${item.position}%` }}
              title={item.title}
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full border text-xs shadow-[0_8px_18px_var(--shadow-soft)]"
                style={{
                  backgroundColor: `color-mix(in srgb, ${item.color} 20%, var(--card))`,
                  borderColor: item.color,
                }}
              >
                {item.icon}
              </span>
              <span className="whitespace-nowrap text-[10px] text-[var(--muted)]">{item.timeLabel}</span>
            </button>
          ))}
          <div
            className="absolute top-3 h-11 w-px bg-[var(--accent)]"
            style={{ left: `${nowPosition}%` }}
          >
            <span className="absolute left-1 top-10 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)]">
              NOW
            </span>
          </div>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-3 text-[11px] text-[var(--muted)]">
        <span><span className="text-[var(--accent)]">●</span> タスク</span>
        <span><span className="text-[var(--success)]">●</span> 予定</span>
        <span><span className="text-[var(--purple)]">●</span> メモ</span>
        <span><span className="text-[var(--subtle)]">●</span> その他</span>
      </div>
    </section>
  );
}

function DayFlow({
  items,
  onOpenRecord,
  onOpenImage,
  onToggleGoogleTaskStatus,
  externalProcessingKey,
}: {
  items: TodayFlowItem[];
  onOpenRecord: (id: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onToggleGoogleTaskStatus: (id: string) => void;
  externalProcessingKey: string;
}) {
  return (
    <section className={panelClass}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
        <span>♪</span>
        <span>Day Flow</span>
      </div>
      <div className="mt-3">
        {items.map((item, index) => {
          const record = item.record;
          const domainColor = record ? getDomainColorVar(record.domain || "other") : "var(--accent)";
          const taskProcessing = record ? externalProcessingKey === `task-status:${record.id}` : false;
          const isLast = index === items.length - 1;
          return (
            <div
              key={item.id}
              role={record ? "button" : undefined}
              tabIndex={record ? 0 : undefined}
              onClick={record ? () => onOpenRecord(record.id) : undefined}
              onKeyDown={
                record
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onOpenRecord(record.id);
                    }
                  : undefined
              }
              className={`grid w-full grid-cols-[4rem_2.1rem_minmax(0,1fr)] gap-2 py-2 text-left ${record ? "cursor-pointer" : ""}`}
            >
              <div className="pt-0.5 font-mono text-xl font-semibold leading-8 text-[var(--text)]">{item.timeLabel}</div>
              <div className="relative flex justify-center">
                {!isLast ? (
                  <span className="absolute left-1/2 top-8 h-[calc(100%+0.75rem)] w-px -translate-x-1/2 bg-[var(--border)]" />
                ) : null}
                <span
                  className="z-10 flex h-8 w-8 items-center justify-center rounded-full border text-base"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${domainColor} 16%, var(--card))`,
                    borderColor: domainColor,
                  }}
                >
                  {item.icon}
                </span>
              </div>
              <div className={`min-w-0 ${!isLast ? "border-b border-[color:var(--border)] pb-2" : ""}`}>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-base font-semibold leading-6 text-[var(--text)]">{item.title}</h3>
                    {item.summary ? <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-[var(--muted)]">{item.summary}</p> : null}
                  </div>
                  {record?.google_task_id && record.google_task_list_id ? (
                    <button
                      type="button"
                      disabled={taskProcessing}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleGoogleTaskStatus(record.id);
                      }}
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        record.google_task_status === "completed"
                          ? "border-[color:var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
                          : "border-[color:var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)]"
                      }`}
                    >
                      {taskProcessing ? "同期中" : record.google_task_status === "completed" ? "完了" : "未完了"}
                    </button>
                  ) : (
                    <Badge compact tone={item.statusTone}>{item.statusLabel}</Badge>
                  )}
                </div>
                {record && (record.attachments || []).length > 0 ? (
                  <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                    <ImageAttachmentGrid attachments={record.attachments} compact maxItems={1} onOpen={onOpenImage} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CompactLoopList({
  title,
  tone,
  records,
  emptyText,
  onOpenRecord,
}: {
  title: string;
  tone: "cyan" | "emerald" | "amber" | "rose" | "slate";
  records: CGMPRecord[];
  emptyText: string;
  onOpenRecord: (id: string) => void;
}) {
  return (
    <section className={panelClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--purple)]">{title}</div>
        <Badge compact tone={tone}>{records.length}件</Badge>
      </div>
      <div className="mt-3 divide-y divide-[color:var(--border)]">
        {records.length > 0 ? (
          records.slice(0, 3).map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => onOpenRecord(record.id)}
              className="flex w-full min-w-0 items-center justify-between gap-2 py-2 text-left"
            >
              <span className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">
                <span className="mr-2">{inferSemanticIcon(record)}</span>
                {record.title || "（無題）"}
              </span>
              <Badge compact tone={record.google_task_status === "completed" ? "emerald" : "amber"}>
                {record.action === "note" ? "note" : record.google_task_status === "completed" ? "完了" : "未完了"}
              </Badge>
            </button>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] px-4 py-3 text-sm text-[var(--subtle)]">
            {emptyText}
          </div>
        )}
        {records.length > 3 ? <div className="text-right text-xs text-[var(--muted)]">ほか {records.length - 3}件</div> : null}
      </div>
    </section>
  );
}

function TodaysInbox({
  records,
  onOpenRecord,
}: {
  records: CGMPRecord[];
  onOpenRecord: (id: string) => void;
}) {
  return (
    <section className={`${panelClass} mb-[calc(5rem+env(safe-area-inset-bottom,0px))]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Today&apos;s Inbox</div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">今日作成され、まだ処理が完了していない項目です。</p>
        </div>
        <Badge compact tone={records.length > 0 ? "amber" : "slate"}>{records.length}件</Badge>
      </div>

      {records.length > 0 ? (
        <div className="mt-3 divide-y divide-[color:var(--border)]">
          {records.slice(0, 3).map((record) => {
            const reason = getUnprocessedReason(record) || { label: "確認待ち", tone: "amber" as const };
            const title = record.title || record.raw_input || "（無題）";
            return (
              <button
                key={record.id}
                type="button"
                onClick={() => onOpenRecord(record.id)}
                className="grid w-full grid-cols-[1.7rem_minmax(0,1fr)_auto] items-center gap-2 py-2 text-left"
              >
                <span className="text-lg leading-none">{inferSemanticIcon(record)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--text)]">{title}</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--muted)]">{createdTimeLabel(record)}</span>
                </span>
                <Badge compact tone={reason.tone}>{reason.label}</Badge>
              </button>
            );
          })}
          {records.length > 3 ? (
            <button
              type="button"
              onClick={() => onOpenRecord(records[3].id)}
              className="w-full py-2 text-right text-xs font-semibold text-[var(--accent)]"
            >
              すべて見る（ほか {records.length - 3}件）
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-[color:var(--border)] px-4 py-3 text-sm text-[var(--subtle)]">
          今日の未処理はありません。
        </div>
      )}
    </section>
  );
}

export function TodayView({
  records,
  settings,
  onOpenRecord,
  onOpenImage,
  onToggleGoogleTaskStatus,
  externalProcessingKey,
}: {
  records: CGMPRecord[];
  settings: CGMPSettings | null;
  onOpenRecord: (id: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onToggleGoogleTaskStatus: (id: string) => void;
  externalProcessingKey: string;
}) {
  const today = new Date();
  const todayKey = dateKeyFromDate(today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowTimeLabel = `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;
  const dayLabel = WEEKDAY_LABELS[today.getDay()];

  const cockpit = useMemo(() => {
    const todayTasksAll = records.filter((record) => isTask(record) && record.date === todayKey);
    const todayTasksIncomplete = todayTasksAll.filter((record) => record.google_task_status !== "completed");
    const todayTimedTasksIncomplete = todayTasksIncomplete
      .filter((record) => Boolean(record.time) && !record.all_day)
      .sort(compareByTime);
    const todayFloatingTasksIncomplete = todayTasksIncomplete
      .filter((record) => !record.time || record.all_day)
      .sort(compareByTime);
    const todayEvents = records
      .filter((record) => record.action === "calendar" && record.date === todayKey)
      .sort(compareByTime);
    const timedRecords = [...todayTimedTasksIncomplete, ...todayEvents]
      .filter((record) => Boolean(record.time) && !record.all_day)
      .sort(compareByTime);
    const notesToday = records
      .filter((record) => record.action === "note" && createdDateKey(record) === todayKey)
      .sort((left, right) => String(right.created_at || right.updated_at).localeCompare(String(left.created_at || left.updated_at)));
    const carryOver = records
      .filter(
        (record) =>
          isIncompleteTask(record) &&
          isGoogleTaskLinked(record) &&
          shouldSyncExternalRecord(record, settings) &&
          Boolean(record.date) &&
          record.date < todayKey
      )
      .sort(compareByTime);

    const nextEvent =
      timedRecords
        .filter((record) => {
          if (!record.time) return false;
          return minutesFromTime(record.time) >= nowMinutes;
        })
        .sort(compareByTime)[0] || null;

    const overdueTask =
      todayTimedTasksIncomplete
        .filter((record) => record.time && minutesFromTime(record.time) <= nowMinutes)
        .sort((left, right) => minutesFromTime(right.time) - minutesFromTime(left.time))[0] || null;
    const upcomingTask =
      todayTimedTasksIncomplete
        .filter((record) => record.time && minutesFromTime(record.time) > nowMinutes)
        .sort(compareByTime)[0] || null;
    const focusTask = overdueTask || todayFloatingTasksIncomplete[0] || upcomingTask || carryOver[0] || null;

    const completedTodayTasks = todayTasksAll.filter((record) => record.google_task_status === "completed").length;
    const load = calculateLoad(records, todayKey, today);
    const flowItems = [
      ...timedRecords.map(buildFlowItem),
      buildNowItem(nowMinutes, nowTimeLabel),
    ].sort((left, right) => left.sortValue - right.sortValue);
    const timelineItems = timedRecords.map((record) => {
      const flowItem = buildFlowItem(record);
      const color = record.action === "calendar" ? "var(--success)" : record.action === "reminder" ? "var(--accent)" : "var(--purple)";
      return {
        ...flowItem,
        position: timelinePosition(minutesFromTime(record.time)),
        color,
      };
    });
    const todayInbox = getTodaysInboxRecords(records, todayKey);

    return {
      todayTasksAll,
      completedTodayTasks,
      nextEvent,
      focusTask,
      load,
      flowItems,
      timelineItems,
      notesToday,
      carryOver,
      todayInbox,
    };
  }, [nowMinutes, nowTimeLabel, records, settings, today, todayKey]);

  const progressText = `${cockpit.completedTodayTasks}/${cockpit.todayTasksAll.length}`;

  return (
    <div
      className="grid max-w-full gap-3 overflow-hidden sm:gap-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.5rem)" }}
    >
      <section className="px-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--text)]">Today</h2>
            <div className="mt-1 text-sm text-[var(--muted)]">
              {formatWeekDate(today)} {dayLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[var(--card)] text-lg font-semibold text-[var(--accent)] shadow-[0_8px_18px_var(--shadow-soft)]"
            aria-label="Todayを再読み込み"
          >
            ↻
          </button>
        </div>
      </section>

      <section className={`${panelClass} p-4 sm:p-5`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">◎ Mission Control</div>
        <div className="mt-3 grid grid-cols-[0.78fr_1.22fr] gap-3">
          <div className="min-w-0 border-r border-[color:var(--border)] pr-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Now</div>
            <div className="mt-1 font-mono text-[42px] font-semibold leading-none text-[var(--text)]">{nowTimeLabel}</div>
            <div className="mt-2 text-2xl leading-none text-[var(--accent)]">☾</div>
            <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{getTimeBandLabel(nowMinutes)}</div>
          </div>
          <div className="grid min-w-0 gap-2">
            <MissionRecordPreview
              label="Next"
              record={cockpit.nextEvent}
              emptyTitle="予定なし"
              emptySummary="今日はこの後の時刻付き予定はありません。"
            />
            <MissionRecordPreview
              label="Focus"
              record={cockpit.focusTask}
              emptyTitle="今すぐ処理すべきタスクはありません"
              emptySummary="未完了の集中対象は落ち着いています。"
              compact
            />
            <div className="grid grid-cols-3 gap-2 border-t border-[color:var(--border)] pt-2">
              <MiniMetric label="Progress" value={progressText} subText="完了" />
              <MiniMetric label="Carry" value={`${cockpit.carryOver.length}件`} subText="持ち越し" />
              <MiniMetric label="Load" value={cockpit.load.label} subText={cockpit.load.subText} />
            </div>
          </div>
        </div>
      </section>

      <DayTimeline items={cockpit.timelineItems} nowMinutes={nowMinutes} />

      <DayFlow
        items={cockpit.flowItems}
        onOpenRecord={onOpenRecord}
        onOpenImage={onOpenImage}
        onToggleGoogleTaskStatus={onToggleGoogleTaskStatus}
        externalProcessingKey={externalProcessingKey}
      />

      <CompactLoopList
        title="Today's Notes"
        tone="cyan"
        records={cockpit.notesToday}
        emptyText="今日作成されたnoteはまだありません。思いついたことをメモしておきましょう。"
        onOpenRecord={onOpenRecord}
      />

      <TodaysInbox records={cockpit.todayInbox} onOpenRecord={onOpenRecord} />
    </div>
  );
}
