"use client";

import { secondaryButtonClass } from "@/components/cgmp/ui";

export type ExternalSyncReportItem = {
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

export type ExternalSyncProgressState = {
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

export type BackupSyncReportItem = {
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

export type BackupSyncProgressState = {
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

export type ShortcutWebhookTraceStep = {
  id: string;
  label: string;
  status: "running" | "success" | "error" | "skipped";
  startedAt: number;
  endedAt?: number;
  elapsedMs?: number;
  detail?: string;
  error?: string;
};

export type ShortcutWebhookDebugTrace = {
  enabled: true;
  totalElapsedMs: number;
  steps: ShortcutWebhookTraceStep[];
};

export type ShortcutWebhookTestReport = {
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

type ExternalSyncProgressModalProps = {
  progress: ExternalSyncProgressState | null;
  onClose: () => void;
};

type BackupSyncProgressModalProps = {
  progress: BackupSyncProgressState | null;
  progressNow: number;
  onClose: () => void;
};

type WebhookTestModalProps = {
  open: boolean;
  running: boolean;
  report: ShortcutWebhookTestReport | null;
  elapsedMs: number;
  onClose: () => void;
};

export function ExternalSyncProgressModal({ progress, onClose }: ExternalSyncProgressModalProps) {
  if (!progress) return null;

  const done = progress.phase === "done" || progress.phase === "error";
  const elapsed = Math.round((progress.finishedAt || performance.now()) - progress.startedAt);
  const activeCount = progress.phase === "applying" ? progress.applied : Math.max(progress.checked, progress.applied);
  const ratio = Math.min(100, Math.round((activeCount / Math.max(1, progress.total)) * 100));
  const slowestItems = [...progress.reportItems]
    .sort((a, b) => b.elapsedMs + b.applyElapsedMs - (a.elapsedMs + a.applyElapsedMs))
    .slice(0, 6);

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
      <section className="w-full max-w-md rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
        <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Google Sync</div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text)]">
              {progress.phase === "done" ? "同期が完了しました" : progress.phase === "error" ? "同期で停止しました" : "Google状態を同期中"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{progress.message}</p>
          </div>
          {!done ? (
            <div className="mt-1 h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">
              {progress.phase === "done" ? "✓" : "!"}
            </div>
          )}
        </div>
        {progress.currentTitle ? (
          <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
            {progress.currentTitle}
          </div>
        ) : null}
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
          <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-300" style={{ width: `${ratio}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
            照合 {progress.checked}/{progress.total}
          </div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
            反映 {progress.applied}/{progress.total}
          </div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">更新 {progress.changed}件</div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">失敗 {progress.failed}件</div>
        </div>
        <div className="mt-3 text-xs text-[var(--subtle)]">経過 {elapsed} ms</div>
        {done ? (
          <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3 text-xs text-[var(--muted)]">
            <div className="font-semibold text-[var(--text)]">同期レポート</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <span>照合: {progress.checkingElapsedMs} ms</span>
              <span>反映: {progress.applyingElapsedMs} ms</span>
              <span>再読込: {progress.reloadElapsedMs} ms</span>
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
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              閉じる
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function BackupSyncProgressModal({ progress, progressNow, onClose }: BackupSyncProgressModalProps) {
  if (!progress) return null;

  const done = progress.phase === "done" || progress.phase === "error";
  const elapsed = Math.round((progress.finishedAt || progressNow || performance.now()) - progress.startedAt);
  const detailItems =
    progress.reportItems.length <= 20 ? progress.reportItems : [...progress.reportItems].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 20);

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
      <section className="w-full max-w-md rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
        <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Drive Backup</div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text)]">
              {progress.phase === "done" ? "バックアップが完了しました" : progress.phase === "error" ? "バックアップで停止しました" : "Google Driveへ同期中"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{progress.message}</p>
          </div>
          {!done ? (
            <div className="mt-1 h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">
              {progress.phase === "done" ? "✓" : "!"}
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">対象 {progress.total}件</div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">成功 {progress.succeeded}件</div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">失敗 {progress.failed}件</div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">経過 {elapsed} ms</div>
        </div>
        {done ? (
          <div className="mt-4 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-3 text-xs text-[var(--muted)]">
            <div className="font-semibold text-[var(--text)]">Drive同期レポート</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <span>処理: {progress.processElapsedMs} ms</span>
              <span>再読込: {progress.reloadElapsedMs} ms</span>
              <span>合計: {elapsed} ms</span>
              <span>対象: {progress.total}件</span>
            </div>
            {detailItems.length > 0 ? (
              <div className="mt-3">
                <div className="font-semibold text-[var(--text)]">{progress.reportItems.length <= 20 ? "処理詳細" : "遅い順 20件"}</div>
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
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              閉じる
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function WebhookTestModal({ open, running, report, elapsedMs, onClose }: WebhookTestModalProps) {
  if (!open) return null;

  const trace = report?.debugTrace;
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
  const done = !running && Boolean(report);
  const elapsed = trace?.totalElapsedMs ?? elapsedMs;
  const statusTone = report?.ok ? "text-[var(--accent)]" : report ? "text-[var(--danger)]" : "text-[var(--muted)]";

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-white/65 px-4 py-5 backdrop-blur-sm dark:bg-slate-950/55 sm:items-center">
      <section className="w-full max-w-xl rounded-[28px] border border-[color:var(--border)] bg-[var(--card)] p-5 shadow-[0_28px_90px_var(--shadow-soft)]">
        <div className="text-[11px] uppercase tracking-[0.34em] text-[var(--accent)]">Webhook Test</div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text)]">{done ? "Webhookテストが完了しました" : "Webhookと同じ処理を実行中"}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              同じ `/api/shortcut-webhook` にdebug付きでPOSTしています。新しい処理経路は使っていません。
            </p>
          </div>
          {!done ? (
            <div className="mt-1 h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-[color:var(--accent-soft)] border-t-[color:var(--accent)]" />
          ) : (
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--card-soft)] text-sm font-bold ${statusTone}`}>
              {report?.ok ? "✓" : "!"}
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted)]">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">経過 {elapsed} ms</div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
            結果 {report ? (report.ok ? "成功" : "失敗") : "実行中"}
          </div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">Action {report?.action || "-"}</div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-3 py-2">
            Date {report?.date || "-"} {report?.time || ""}
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
                    <div className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase ${badgeClass}`}>{stepStatus}</div>
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
          {report?.confirmationText ? (
            <div className="mt-3 rounded-xl border border-[color:var(--border)] bg-[var(--card)] px-3 py-2 text-sm leading-6 text-[var(--text)]">
              {report.confirmationText}
            </div>
          ) : null}
          {report?.error ? (
            <div className="mt-3 rounded-xl border border-[color:var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs leading-5 text-[var(--danger)]">
              {report.error}
            </div>
          ) : null}
        </div>

        {done ? (
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              閉じる
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
