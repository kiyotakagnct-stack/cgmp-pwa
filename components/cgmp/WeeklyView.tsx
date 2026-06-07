"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ImageAttachmentGrid } from "@/components/ImageAttachmentGrid";
import {
  Badge,
  getDomainColorVar,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  SectionHeading,
} from "@/components/cgmp/ui";
import {
  addDays,
  dateKeyFromDate,
  formatWeekDate,
  formatWeekRange,
  getActionSymbol,
  getDomainSymbol,
  getRecordTimeline,
  scrollToElementById,
  WEEKDAY_LABELS,
  WEEKDAY_MINI_LABELS,
} from "@/lib/cgmp/client-utils";
import { getRecordSemanticIcon } from "@/lib/cgmp/semantic-icons";
import { formatJstDateTime } from "@/lib/cgmp/utils";
import type { CGMPRecord } from "@/lib/cgmp/types";
import type { ImageAttachment } from "@/types/image";

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
  const semanticIcon = getRecordSemanticIcon(record);

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
        <span className="shrink-0 text-lg leading-none sm:text-xl" title={record.icon?.label || "Semantic icon"}>
          {semanticIcon}
        </span>
        <span className="shrink-0 text-sm leading-none opacity-70 sm:text-base">{getActionSymbol(record)}</span>
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
      data-swipe-ignore="true"
      onPointerDown={revealMinimap}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setIsExpanded(false);
      }}
      className={`fixed right-1 top-[7.75rem] max-h-[min(34rem,calc(100svh-12rem))] select-none overflow-hidden rounded-3xl border transition-all duration-200 sm:right-3 sm:top-24 ${
        isExpanded
          ? "z-[70] w-16 border-[color:var(--border)] bg-[var(--card)] px-1.5 py-2 opacity-95 shadow-[0_18px_44px_var(--shadow-soft)] backdrop-blur-xl sm:w-[4.5rem]"
          : "z-30 w-9 border-transparent bg-transparent px-1 py-1 opacity-40 shadow-none backdrop-blur-none hover:opacity-70 sm:w-10"
      }`}
      aria-label="Weekly Minimap"
    >
      <div
        className={`max-h-[inherit] overflow-y-auto overscroll-contain ${isExpanded ? "space-y-1.5 pr-0.5" : "space-y-1"}`}
      >
        {days.map((day, index) => {
          const isActive = activeDay === index;
          const isToday = day.dateKey === todayKey;
          const lineCount = Math.max(1, day.records.length);
          const lineHeight =
            lineCount > 24 ? (isExpanded ? 2 : 1) : lineCount > 14 ? (isExpanded ? 3 : 1) : isExpanded ? 4 : 3;
          const lineGap = lineCount > 18 ? 1 : isExpanded ? 2 : 1;
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
              className={`overflow-hidden rounded-2xl border transition ${
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
              <div
                className={isExpanded ? "min-w-0 overflow-hidden pt-0.5" : "overflow-hidden"}
                style={{ display: "grid", gap: `${lineGap}px` } as CSSProperties}
              >
                {day.records.length > 0 ? (
                  day.records.map((record) => {
                    const color = getDomainColorVar(record.domain || "other");
                    return (
                      <div
                        key={record.id}
                        className="flex w-full items-center overflow-hidden rounded-sm"
                        style={{ height: `${lineHeight}px` } as CSSProperties}
                        aria-hidden="true"
                      >
                        <span
                          className="min-w-0 flex-1 rounded-full"
                          style={{
                            backgroundColor: color,
                            height: `${Math.max(1, Math.floor(lineHeight / 2))}px`,
                            opacity: isExpanded ? 0.9 : 0.65,
                          } as CSSProperties}
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

export function WeeklyView({
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
