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

export function RecordEditor({
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

