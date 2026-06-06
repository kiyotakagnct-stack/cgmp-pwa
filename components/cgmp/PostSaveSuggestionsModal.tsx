"use client";

import { Badge, DomainBadge, primaryButtonClass, secondaryButtonClass } from "@/components/cgmp/ui";
import type { SimilarRecord } from "@/lib/cgmp/embedding";

export type ExternalConfirmState = {
  recordId: string;
  action: "reminder" | "calendar";
  title: string;
} | null;

type PostSaveSuggestionsModalProps = {
  externalConfirm: ExternalConfirmState;
  relatedCandidates: SimilarRecord[];
  onConfirmExternalRegistration: () => void;
  onDismissExternalConfirm: () => void;
  onOpenRelatedRecord: (recordId: string) => void;
  onDismissRelatedCandidates: () => void;
};

export function PostSaveSuggestionsModal({
  externalConfirm,
  relatedCandidates,
  onConfirmExternalRegistration,
  onDismissExternalConfirm,
  onOpenRelatedRecord,
  onDismissRelatedCandidates,
}: PostSaveSuggestionsModalProps) {
  if (!externalConfirm && relatedCandidates.length === 0) return null;

  return (
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
              <button type="button" onClick={onConfirmExternalRegistration} className={primaryButtonClass}>
                登録する
              </button>
              <button type="button" onClick={onDismissExternalConfirm} className={secondaryButtonClass}>
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
                        <Badge compact key={tag}>
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => onOpenRelatedRecord(item.record.id)} className={secondaryButtonClass}>
                      開く
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onDismissRelatedCandidates} className={primaryButtonClass}>
                閉じる
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
