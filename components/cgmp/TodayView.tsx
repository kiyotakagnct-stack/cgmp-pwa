"use client";

import { useMemo } from "react";

import { ImageAttachmentGrid } from "@/components/ImageAttachmentGrid";
import { Badge, panelClass, SectionHeading } from "@/components/cgmp/ui";
import {
  dateKeyFromDate,
  formatWeekDate,
  getActionSymbol,
  getDomainSymbol,
  getJstParts,
  getRecordTimeline,
  minutesFromTime,
  shouldSyncExternalRecord,
  WEEKDAY_LABELS,
} from "@/lib/cgmp/client-utils";
import type { CGMPRecord, CGMPSettings } from "@/lib/cgmp/types";
import type { ImageAttachment } from "@/types/image";

type TodaySection = {
  title: string;
  subtitle: string;
  records: CGMPRecord[];
  emptyText: string;
  tone?: "cyan" | "emerald" | "amber" | "rose" | "slate";
};

function isIncompleteTask(record: CGMPRecord) {
  if (record.action !== "reminder") return false;
  return record.google_task_status !== "completed";
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

function sortByTodayTime(left: CGMPRecord, right: CGMPRecord) {
  const leftTimeline = getRecordTimeline(left);
  const rightTimeline = getRecordTimeline(right);
  if (leftTimeline.sortValue !== rightTimeline.sortValue) return leftTimeline.sortValue - rightTimeline.sortValue;
  return String(left.created_at || left.updated_at).localeCompare(String(right.created_at || right.updated_at));
}

function recordSummary(record: CGMPRecord) {
  return record.summary || record.user_intent_summary || record.body || record.raw_input || "";
}

function TodayRecordItem({
  record,
  compact = false,
  onOpenRecord,
  onOpenImage,
  onToggleGoogleTaskStatus,
  externalProcessingKey,
}: {
  record: CGMPRecord;
  compact?: boolean;
  onOpenRecord: (id: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onToggleGoogleTaskStatus: (id: string) => void;
  externalProcessingKey: string;
}) {
  const timeline = getRecordTimeline(record);
  const summary = recordSummary(record);
  const taskProcessing = externalProcessingKey === `task-status:${record.id}`;
  const canToggleTask = Boolean(record.google_task_id && record.google_task_list_id);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpenRecord(record.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenRecord(record.id);
      }}
      className="group min-w-0 cursor-pointer overflow-hidden rounded-[22px] border border-[color:var(--border)] bg-[var(--card)] p-3 transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="shrink-0 font-mono text-base font-semibold text-[var(--text)]">{timeline.timeLabel}</span>
        <span className="rounded-full bg-[var(--card-soft)] px-2 py-0.5 text-[11px] text-[var(--subtle)]">
          {timeline.sourceLabel}
        </span>
        <span className="text-lg leading-none">{getActionSymbol(record)}</span>
        <span className="text-lg leading-none">{getDomainSymbol(record.domain)}</span>
        {canToggleTask ? (
          <button
            type="button"
            disabled={taskProcessing}
            onClick={(event) => {
              event.stopPropagation();
              onToggleGoogleTaskStatus(record.id);
            }}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              record.google_task_status === "completed"
                ? "border-[color:var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
                : "border-[color:var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)]"
            }`}
          >
            {taskProcessing ? "同期中" : record.google_task_status === "completed" ? "完了" : "未完"}
          </button>
        ) : null}
        <h3 className="min-w-[10rem] flex-1 truncate text-base font-semibold text-[var(--text)]">
          {record.title || "（無題）"}
        </h3>
      </div>

      {!compact && summary ? (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">{summary}</p>
      ) : null}

      {!compact && (record.attachments || []).length > 0 ? (
        <div className="mt-3" onClick={(event) => event.stopPropagation()}>
          <ImageAttachmentGrid attachments={record.attachments} compact maxItems={2} onOpen={onOpenImage} />
        </div>
      ) : null}
    </article>
  );
}

function TodaySectionBlock({
  section,
  onOpenRecord,
  onOpenImage,
  onToggleGoogleTaskStatus,
  externalProcessingKey,
}: {
  section: TodaySection;
  onOpenRecord: (id: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onToggleGoogleTaskStatus: (id: string) => void;
  externalProcessingKey: string;
}) {
  return (
    <section className="rounded-[24px] border border-[color:var(--border)] bg-[var(--card-soft)] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-[var(--text)]">{section.title}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{section.subtitle}</p>
        </div>
        <Badge tone={section.tone || (section.records.length > 0 ? "emerald" : "slate")} compact>
          {section.records.length}件
        </Badge>
      </div>
      <div className="mt-3 grid gap-2">
        {section.records.length > 0 ? (
          section.records.map((record) => (
            <TodayRecordItem
              key={record.id}
              record={record}
              onOpenRecord={onOpenRecord}
              onOpenImage={onOpenImage}
              onToggleGoogleTaskStatus={onToggleGoogleTaskStatus}
              externalProcessingKey={externalProcessingKey}
            />
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] px-4 py-4 text-sm text-[var(--subtle)]">
            {section.emptyText}
          </div>
        )}
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
  const dayLabel = WEEKDAY_LABELS[today.getDay()];

  const cockpit = useMemo(() => {
    const todayTasks = records.filter((record) => isIncompleteTask(record) && record.date === todayKey);
    const timedTasks = todayTasks
      .filter((record) => Boolean(record.time) && !record.all_day)
      .sort(sortByTodayTime);
    const scheduled = records
      .filter((record) => record.action === "calendar" && record.date === todayKey)
      .sort(sortByTodayTime);
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
      .sort(sortByTodayTime);

    const upcomingTask = timedTasks
      .filter((record) => minutesFromTime(record.time) >= nowMinutes)
      .sort((left, right) => minutesFromTime(left.time) - minutesFromTime(right.time))[0];
    const upcomingCalendar = scheduled
      .filter((record) => {
        if (record.all_day) return false;
        if (!record.time) return true;
        return minutesFromTime(record.time) >= nowMinutes;
      })
      .sort(sortByTodayTime)[0];
    const nextAction =
      upcomingTask ||
      upcomingCalendar ||
      timedTasks[0] ||
      carryOver[0] ||
      null;

    return {
      nextAction,
      timedTasks,
      scheduled,
      notesToday,
      carryOver,
    };
  }, [nowMinutes, records, settings, todayKey]);

  const sections: TodaySection[] = [
    {
      title: "Must Do Today",
      subtitle: "今日の日付と時刻を持つ未完了タスク。",
      records: cockpit.timedTasks,
      emptyText: "時刻つきの未完了タスクはありません。",
      tone: "rose",
    },
    {
      title: "Scheduled",
      subtitle: "今日の予定。終日予定は上に来ます。",
      records: cockpit.scheduled,
      emptyText: "今日の予定はありません。",
      tone: "amber",
    },
    {
      title: "Notes Captured Today",
      subtitle: "今日作成されたnote。作業ログや気づきの置き場です。",
      records: cockpit.notesToday,
      emptyText: "今日作成されたnoteはまだありません。",
      tone: "slate",
    },
    {
      title: "Carry-over",
      subtitle: "外部同期対象に入っているGoogle Tasks連携済みの古い未完了タスク。",
      records: cockpit.carryOver,
      emptyText: "持ち越しタスクはありません。",
      tone: "amber",
    },
  ];

  return (
    <div className="grid max-w-full gap-3 overflow-hidden sm:gap-4">
      <section className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading eyebrow="Today" title="今日の作業台" />
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-4 py-2 text-right">
            <div className="text-base font-semibold text-[var(--text)]">{formatWeekDate(today)}</div>
            <div className="mt-0.5 text-xs text-[var(--muted)]">{dayLabel}</div>
          </div>
        </div>

        <div className="mt-4 rounded-[24px] border border-[color:var(--accent)] bg-[var(--accent-soft)] p-4">
          <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--accent)]">Next Action</div>
          {cockpit.nextAction ? (
            <div className="mt-3">
              <TodayRecordItem
                record={cockpit.nextAction}
                compact
                onOpenRecord={onOpenRecord}
                onOpenImage={onOpenImage}
                onToggleGoogleTaskStatus={onToggleGoogleTaskStatus}
                externalProcessingKey={externalProcessingKey}
              />
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-dashed border-[color:var(--border)] bg-[var(--card)] px-4 py-5 text-sm text-[var(--muted)]">
              今日は大きな未完了タスクはありません。
            </div>
          )}
        </div>
      </section>

      {sections.map((section) => (
        <TodaySectionBlock
          key={section.title}
          section={section}
          onOpenRecord={onOpenRecord}
          onOpenImage={onOpenImage}
          onToggleGoogleTaskStatus={onToggleGoogleTaskStatus}
          externalProcessingKey={externalProcessingKey}
        />
      ))}
    </div>
  );
}
