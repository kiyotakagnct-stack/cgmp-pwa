"use client";

import {
  LabeledInput,
  LabeledNumber,
  LabeledSelect,
  LabeledTextarea,
  LabeledToggle,
} from "@/components/cgmp/ui";
import type { RecordFormState } from "@/lib/cgmp/client-utils";
import { normalizeAction, normalizeDomain, normalizePara } from "@/lib/cgmp/utils";

const FIELD_SUMMARY_ITEMS = [
  { id: "record-action", label: "Action", value: (draft: RecordFormState) => draft.action || "未設定" },
  { id: "record-date", label: "Date", value: (draft: RecordFormState) => draft.date || "未設定" },
  { id: "record-time", label: "Time", value: (draft: RecordFormState) => draft.time || "未設定" },
  {
    id: "record-duration",
    label: "Duration",
    value: (draft: RecordFormState) =>
      Number.isFinite(draft.duration_minutes) ? `${draft.duration_minutes}m` : "未設定",
  },
  { id: "record-para", label: "PARA", value: (draft: RecordFormState) => draft.para || "未設定" },
  { id: "record-domain", label: "Domain", value: (draft: RecordFormState) => draft.domain || "未設定" },
] as const;

export function RecordEditor({
  draft,
  onChange,
  showRawInput = false,
}: {
  draft: RecordFormState;
  onChange: (patch: Partial<RecordFormState>) => void;
  showRawInput?: boolean;
}) {
  function jumpToField(fieldId: string) {
    const target = document.getElementById(fieldId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });

    const focusable = target.querySelector<HTMLElement>("input, textarea, select, button");
    focusable?.focus();
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 rounded-2xl border border-[color:var(--border)] bg-[var(--card)]/95 p-2 shadow-[0_10px_26px_var(--shadow-soft)] backdrop-blur">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          {FIELD_SUMMARY_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => jumpToField(item.id)}
              className="min-w-0 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] px-2.5 py-2 text-left transition hover:border-[color:var(--accent)] hover:bg-[var(--accent-soft)]"
            >
              <span className="block text-[9px] uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</span>
              <span className="mt-1 block truncate text-[11px] font-semibold text-[var(--text)]">{item.value(draft)}</span>
            </button>
          ))}
        </div>
      </div>

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
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledSelect
              id="record-action"
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
              id="record-para"
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
              id="record-domain"
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
              id="record-duration"
              label="Duration (min)"
              value={draft.duration_minutes}
              onChange={(value) => onChange({ duration_minutes: value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput
              id="record-date"
              label="Date"
              value={draft.date}
              onChange={(value) => onChange({ date: value })}
              placeholder="YYYY-MM-DD"
            />
            <LabeledInput
              id="record-time"
              label="Time"
              value={draft.time}
              onChange={(value) => onChange({ time: value })}
              placeholder="HH:mm"
            />
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
    </div>
  );
}
