"use client";

import { useRef } from "react";

import { ImageAttachmentGrid } from "@/components/ImageAttachmentGrid";
import {
  Badge,
  DomainBadge,
} from "@/components/cgmp/ui";
import {
  getActionInfo,
  getActionLabel,
  getBackupInfo,
  getBackupLabel,
  getBackupTone,
  getCalendarInfo,
  getDomainInfo,
  getEffectivePara,
  getParaInfo,
  getParaLabel,
  getPhotoBackupBadge,
  getPhotoBackupInfo,
  getTaskInfo,
  type BadgeInfo,
} from "@/lib/cgmp/client-utils";
import { formatJstDateTime } from "@/lib/cgmp/utils";
import type { CGMPRecord } from "@/lib/cgmp/types";
import type { ImageAttachment } from "@/types/image";

export function RecordCard({
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
  onAnalyzeRecord,
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
  onAnalyzeRecord: (recordId: string) => void;
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
  const aiProcessing = externalProcessingKey === `draft-ai:${record.id}`;
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
                disabled={aiProcessing}
                onClick={(event) => {
                  event.stopPropagation();
                  onAnalyzeRecord(record.id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="whitespace-nowrap rounded-full border border-[color:var(--accent)] bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold text-[var(--accent-contrast)] shadow-[0_6px_16px_var(--shadow-soft)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiProcessing ? "解析中..." : "AI解析"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={aiProcessing}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAnalyzeRecord(record.id);
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="whitespace-nowrap rounded-full border border-[color:var(--accent)] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-contrast)] shadow-[0_6px_16px_var(--shadow-soft)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiProcessing ? "解析中..." : "AI解析"}
                </button>
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
                      onAnalyzeRecord(record.id);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="rounded-xl border border-[color:var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={aiProcessing}
                  >
                    {aiProcessing ? "解析中..." : "AI解析"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAnalyzeRecord(record.id);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="rounded-xl border border-[color:var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={aiProcessing}
                  >
                    {aiProcessing ? "解析中..." : "AI解析"}
                  </button>
                )}
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

export function MiniRecordCard({
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

