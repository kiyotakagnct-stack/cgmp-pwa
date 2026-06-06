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

const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 24 * 60;
const TIMELINE_RANGE = DAY_END_MINUTES - DAY_START_MINUTES;

const SEMANTIC_ICON_RULES: Array<{ icon: string; keywords: string[] }> = [
  { icon: "🦷", keywords: ["歯医者", "歯科", "デンタル"] },
  { icon: "🏥", keywords: ["病院", "眼科", "耳鼻科", "通院"] },
  { icon: "👥", keywords: ["会議", "打合せ", "打ち合わせ", "ミーティング", "1on1"] },
  { icon: "💬", keywords: ["相談", "すり合わせ", "認識合わせ"] },
  { icon: "📞", keywords: ["電話", "tel", "連絡"] },
  { icon: "✉️", keywords: ["メール", "返信", "送信"] },
  { icon: "📄", keywords: ["資料", "文書", "レポート", "議事録"] },
  { icon: "🔍", keywords: ["確認", "レビュー", "チェック", "検証"] },
  { icon: "🧭", keywords: ["方針", "整理", "段取り", "計画"] },
  { icon: "🧳", keywords: ["旅行", "出張", "ホテル", "予約", "旅程"] },
  { icon: "🛒", keywords: ["買う", "購入", "買い物"] },
  { icon: "💳", keywords: ["支払い", "精算", "請求", "カード"] },
  { icon: "🚲", keywords: ["自転車", "ロードバイク", "運動"] },
  { icon: "🍽️", keywords: ["食事", "ご飯", "弁当", "ランチ"] },
  { icon: "🎒", keywords: ["学校", "授業", "宿題", "習い事"] },
  { icon: "🧒", keywords: ["子供", "凜", "瑛", "瑛登"] },
  { icon: "💡", keywords: ["アイデア", "考える", "構想"] },
  { icon: "💻", keywords: ["実装", "codex", "コード", "next.js", "scriptable"] },
  { icon: "🧪", keywords: ["試験", "評価", "実験", "検査"] },
  { icon: "🏭", keywords: ["生産", "設備", "現場", "ライン"] },
  { icon: "📦", keywords: ["出荷", "梱包", "物流", "納入"] },
  { icon: "⏰", keywords: ["締切", "督促", "期限"] },
];

function recordSummary(record: CGMPRecord) {
  return record.summary || record.user_intent_summary || record.body || record.raw_input || "";
}

function recordSearchText(record: CGMPRecord) {
  return [
    record.title,
    record.summary,
    record.body,
    record.raw_input,
    ...(record.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferSemanticIcon(record: CGMPRecord) {
  const manualIcon = (record as CGMPRecord & { icon?: { emoji?: string; source?: string } }).icon;
  if (manualIcon?.emoji && manualIcon.source === "manual") return manualIcon.emoji;
  if (manualIcon?.emoji) return manualIcon.emoji;

  const text = recordSearchText(record);
  for (const rule of SEMANTIC_ICON_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) return rule.icon;
  }

  if (record.action === "calendar") return "📅";
  if (record.action === "reminder") return "✅";
  if (record.action === "note") return "📝";
  if (record.action === "unclear") return "?";
  return "•";
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
    <div className="min-w-0 rounded-2xl border border-[color:var(--border)] bg-[var(--card)]/55 px-3 py-2">
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
}: {
  label: string;
  record: CGMPRecord | null;
  emptyTitle: string;
  emptySummary: string;
}) {
  return (
    <div className="min-w-0 border-t border-[color:var(--border)] pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
        <span>{label}</span>
      </div>
      {record ? (
        <div className="mt-1 flex min-w-0 items-start gap-2">
          <span className="mt-0.5 text-xl leading-none">{inferSemanticIcon(record)}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text)]">{record.title || "（無題）"}</div>
            <div className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">{recordSummary(record)}</div>
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
      <div className="mt-4 px-2">
        <div className="relative h-24">
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
              className="absolute top-[18px] flex -translate-x-1/2 flex-col items-center gap-1"
              style={{ left: `${item.position}%` }}
              title={item.title}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full border text-sm shadow-[0_8px_18px_var(--shadow-soft)]"
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
            className="absolute top-3 h-12 w-px bg-[var(--accent)]"
            style={{ left: `${nowPosition}%` }}
          >
            <span className="absolute left-1 top-11 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-contrast)]">
              NOW
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-[11px] text-[var(--muted)]">
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
      <div className="mt-4 grid gap-3">
        {items.map((item) => {
          const record = item.record;
          const domainColor = record ? getDomainColorVar(record.domain || "other") : "var(--accent)";
          const taskProcessing = record ? externalProcessingKey === `task-status:${record.id}` : false;
          return (
            <article
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
              className="grid grid-cols-[4.4rem_2.4rem_minmax(0,1fr)] gap-2 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3"
            >
              <div className="font-mono text-base font-semibold text-[var(--text)]">{item.timeLabel}</div>
              <div className="relative flex justify-center">
                <span
                  className="z-10 flex h-8 w-8 items-center justify-center rounded-full border text-lg"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${domainColor} 16%, var(--card))`,
                    borderColor: domainColor,
                  }}
                >
                  {item.icon}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-sm font-semibold text-[var(--text)]">{item.title}</h3>
                    {item.summary ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{item.summary}</p> : null}
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
            </article>
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
      <div className="mt-3 grid gap-2">
        {records.length > 0 ? (
          records.slice(0, 3).map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => onOpenRecord(record.id)}
              className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2 text-left"
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
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] px-4 py-4 text-sm text-[var(--subtle)]">
            {emptyText}
          </div>
        )}
        {records.length > 3 ? <div className="text-right text-xs text-[var(--muted)]">ほか {records.length - 3}件</div> : null}
      </div>
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
    const openLoops = [...todayFloatingTasksIncomplete, ...carryOver];

    return {
      todayTasksAll,
      completedTodayTasks,
      nextEvent,
      focusTask,
      load,
      flowItems,
      timelineItems,
      openLoops,
      notesToday,
      carryOver,
    };
  }, [nowMinutes, nowTimeLabel, records, settings, today, todayKey]);

  const progressText = `${cockpit.completedTodayTasks}/${cockpit.todayTasksAll.length}`;

  return (
    <div className="grid max-w-full gap-3 overflow-hidden sm:gap-4">
      <section className="px-1 pt-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-[var(--text)]">Today</h2>
            <div className="mt-1 text-sm text-[var(--muted)]">
              {formatWeekDate(today)} {dayLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full border border-[color:var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-semibold text-[var(--accent)] shadow-[0_8px_18px_var(--shadow-soft)]"
            aria-label="Todayを再読み込み"
          >
            ↻
          </button>
        </div>
      </section>

      <section className={panelClass}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">◎ Mission Control</div>
        <div className="mt-4 grid gap-4 md:grid-cols-[0.9fr_1.4fr]">
          <div className="rounded-3xl border border-[color:var(--border)] bg-[var(--card-soft)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Now</div>
            <div className="mt-2 font-mono text-5xl font-semibold text-[var(--text)]">{nowTimeLabel}</div>
            <div className="mt-3 text-3xl text-[var(--accent)]">☾</div>
            <div className="mt-1 text-sm text-[var(--muted)]">{getTimeBandLabel(nowMinutes)}</div>
          </div>
          <div className="grid gap-3">
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
            />
            <div className="grid grid-cols-3 gap-2">
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
        title="Open Loops"
        tone="amber"
        records={cockpit.openLoops}
        emptyText="時間軸に載らない未完了の輪っかはありません。"
        onOpenRecord={onOpenRecord}
      />

      <CompactLoopList
        title="Today's Notes"
        tone="cyan"
        records={cockpit.notesToday}
        emptyText="今日作成されたnoteはまだありません。思いついたことをメモしておきましょう。"
        onOpenRecord={onOpenRecord}
      />
    </div>
  );
}
