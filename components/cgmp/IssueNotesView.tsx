"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Badge,
  fieldClass,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  softPanelClass,
  textareaClass,
  SectionHeading,
} from "@/components/cgmp/ui";
import { getImageBlob } from "@/lib/db/imageBlobStore";
import type { CGMPIssueNote, CGMPIssueNoteImage, CGMPIssueNoteStatus, CGMPRecord } from "@/lib/cgmp/types";
import { formatJstDateTime } from "@/lib/cgmp/utils";

type IssueNotesViewProps = {
  issues: CGMPIssueNote[];
  records: CGMPRecord[];
  onCreateIssue: () => Promise<CGMPIssueNote | null>;
  onSaveIssue: (issue: CGMPIssueNote) => Promise<CGMPIssueNote | null>;
  onArchiveIssue: (id: string) => Promise<void>;
  onDeleteIssue: (id: string) => Promise<void>;
  onAddImages: (issueId: string, files: File[]) => Promise<CGMPIssueNote | null>;
  onCaptionImage: (issueId: string, imageId: string) => Promise<CGMPIssueNote | null>;
  onOpenRecord: (id: string) => void;
};

const STATUS_OPTIONS: Array<{ value: CGMPIssueNoteStatus; label: string; tone: "cyan" | "amber" | "emerald" | "slate" }> = [
  { value: "open", label: "進行中", tone: "cyan" },
  { value: "paused", label: "保留", tone: "amber" },
  { value: "resolved", label: "解決", tone: "emerald" },
  { value: "archived", label: "Archive", tone: "slate" },
];

const ISSUE_DRAFT_STORAGE_PREFIX = "cgmp_issue_draft:";
const ISSUE_SELECTED_STORAGE_KEY = "cgmp_issue_selected_id";

type CachedIssueDraft = {
  draft: CGMPIssueNote;
  savedAt: string;
};

type IssueMarkdownField = "context_markdown" | "body_markdown";

type MarkdownRenderOptions = {
  onToggleTask?: (lineIndex: number) => void;
};

type IssueListMode = "active" | "archived";

function getStatusMeta(status: CGMPIssueNoteStatus) {
  return STATUS_OPTIONS.find((option) => option.value === status) || STATUS_OPTIONS[0];
}

function issueDraftStorageKey(issueId: string) {
  return `${ISSUE_DRAFT_STORAGE_PREFIX}${issueId}`;
}

function readCachedIssueDraft(issueId: string): CachedIssueDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(issueDraftStorageKey(issueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedIssueDraft>;
    if (!parsed.draft?.id || parsed.draft.id !== issueId) return null;
    return {
      draft: parsed.draft as CGMPIssueNote,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeCachedIssueDraft(issue: CGMPIssueNote) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      issueDraftStorageKey(issue.id),
      JSON.stringify({
        draft: issue,
        savedAt: new Date().toISOString(),
      } satisfies CachedIssueDraft)
    );
  } catch {
    // iOS may reject localStorage writes in low-storage/private contexts.
  }
}

function clearCachedIssueDraft(issueId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(issueDraftStorageKey(issueId));
  } catch {
    // ignore
  }
}

function issueSearchText(issue: CGMPIssueNote) {
  return [
    issue.title,
    issue.purpose,
    issue.context_markdown,
    issue.body_markdown,
    issue.status,
    ...issue.image_attachments.map((image) => image.ai_caption || image.filename || ""),
  ]
    .join("\n")
    .toLowerCase();
}

function recordSearchText(record: CGMPRecord) {
  return [record.title, record.summary, record.body, record.raw_input, ...(record.tags || [])].join("\n").toLowerCase();
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </>
  );
}

function renderMarkdown(markdown: string, imageUrls: Map<string, string>, images: CGMPIssueNoteImage[], options: MarkdownRenderOptions = {}) {
  const imageById = new Map(images.map((image) => [image.id, image]));
  return String(markdown || "")
    .split(/\n/)
    .map((rawLine, index) => {
      const line = rawLine.trimEnd();
      const imageMatch = line.match(/^!\[(.*?)\]\(cgmp-issue-image:\/\/([^)]+)\)$/);
      if (imageMatch) {
        const [, alt, imageId] = imageMatch;
        const image = imageById.get(imageId);
        const url = imageUrls.get(imageId);
        return (
          <figure key={`${imageId}-${index}`} className="my-3 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[var(--card)]">
            {url ? (
              <img src={url} alt={alt || image?.ai_caption || "Issue image"} className="max-h-[360px] w-full object-contain" />
            ) : (
              <div className="flex min-h-32 items-center justify-center text-sm text-[var(--muted)]">画像を読み込み中...</div>
            )}
            <figcaption className="border-t border-[color:var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
              {image?.ai_caption || alt || image?.filename || imageId}
            </figcaption>
          </figure>
        );
      }
      if (!line.trim()) return <div key={`blank-${index}`} className="h-3" />;
      if (line.startsWith("### ")) {
        return <h4 key={index} className="mt-3 text-base font-semibold text-[var(--text)]"><InlineMarkdown text={line.slice(4)} /></h4>;
      }
      if (line.startsWith("## ")) {
        return <h3 key={index} className="mt-4 text-lg font-semibold text-[var(--text)]"><InlineMarkdown text={line.slice(3)} /></h3>;
      }
      if (line.startsWith("# ")) {
        return <h2 key={index} className="mt-4 text-xl font-semibold text-[var(--text)]"><InlineMarkdown text={line.slice(2)} /></h2>;
      }
      if (/^- \[[ xX]\]\s+/.test(line)) {
        const checked = /^- \[[xX]\]/.test(line);
        const content = (
          <>
            <span
              aria-hidden="true"
              className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${
                checked ? "border-[color:var(--success)] bg-[var(--success)] text-white" : "border-[color:var(--border)] bg-[var(--card)]"
              }`}
            >
              {checked ? "✓" : ""}
            </span>
            <span className="min-w-0 flex-1">
              <InlineMarkdown text={line.replace(/^- \[[ xX]\]\s+/, "")} />
            </span>
          </>
        );
        if (options.onToggleTask) {
          return (
            <button
              key={index}
              type="button"
              aria-pressed={checked}
              aria-label={checked ? "チェックを外す" : "チェックする"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                options.onToggleTask?.(index);
              }}
              className="my-1 flex w-full items-start gap-2 rounded-xl px-2 py-1 text-left text-sm leading-6 text-[var(--text)] transition hover:bg-[var(--accent-soft)] active:scale-[0.99]"
            >
              {content}
            </button>
          );
        }
        return (
          <div key={index} className="my-1 flex gap-2 text-sm leading-6 text-[var(--text)]">
            {content}
          </div>
        );
      }
      if (line.startsWith("- ")) {
        return <div key={index} className="my-1 text-sm leading-6 text-[var(--text)]">・<InlineMarkdown text={line.slice(2)} /></div>;
      }
      if (/^\d+\.\s+/.test(line)) {
        return <div key={index} className="my-1 text-sm leading-6 text-[var(--text)]"><InlineMarkdown text={line} /></div>;
      }
      if (line.startsWith("> ")) {
        return <blockquote key={index} className="my-2 border-l-4 border-[color:var(--accent)] pl-3 text-sm leading-6 text-[var(--muted)]"><InlineMarkdown text={line.slice(2)} /></blockquote>;
      }
      return <p key={index} className="my-1 text-sm leading-6 text-[var(--text)]"><InlineMarkdown text={line} /></p>;
    });
}

export function IssueNotesView({
  issues,
  records,
  onCreateIssue,
  onSaveIssue,
  onArchiveIssue,
  onDeleteIssue,
  onAddImages,
  onCaptionImage,
  onOpenRecord,
}: IssueNotesViewProps) {
  const [selectedId, setSelectedId] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(ISSUE_SELECTED_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [draft, setDraft] = useState<CGMPIssueNote | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [issueListMode, setIssueListMode] = useState<IssueListMode>("active");
  const [previewMode, setPreviewMode] = useState<"viewer" | "editor">("viewer");
  const [saving, setSaving] = useState(false);
  const [captioningId, setCaptioningId] = useState("");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const draftRef = useRef<CGMPIssueNote | null>(null);
  const draftDirtyRef = useRef(false);
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());

  const activeIssueCount = useMemo(() => issues.filter((issue) => issue.status !== "archived").length, [issues]);
  const archivedIssueCount = useMemo(() => issues.filter((issue) => issue.status === "archived").length, [issues]);

  const modeIssues = useMemo(
    () => issues.filter((issue) => (issueListMode === "archived" ? issue.status === "archived" : issue.status !== "archived")),
    [issueListMode, issues]
  );

  const filteredIssues = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return modeIssues;
    return modeIssues.filter((issue) => issueSearchText(issue).includes(normalized));
  }, [modeIssues, query]);

  const selectedIssue = useMemo(
    () => filteredIssues.find((issue) => issue.id === selectedId) || filteredIssues[0] || null,
    [filteredIssues, selectedId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedId) {
        window.localStorage.setItem(ISSUE_SELECTED_STORAGE_KEY, selectedId);
      } else {
        window.localStorage.removeItem(ISSUE_SELECTED_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [selectedId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    draftDirtyRef.current = draftDirty;
  }, [draftDirty]);

  useEffect(() => {
    if (!selectedIssue) {
      setSelectedId("");
      setDraft(null);
      setDraftDirty(false);
      return;
    }
    if (!selectedId || !issues.some((issue) => issue.id === selectedId)) {
      setSelectedId(selectedIssue.id);
    }
    if (draftDirtyRef.current && draftRef.current?.id === selectedIssue.id) {
      return;
    }
    const cached = readCachedIssueDraft(selectedIssue.id);
    if (cached) {
      setDraft(cached.draft);
      setDraftDirty(true);
      return;
    }
    setDraft(selectedIssue);
    setDraftDirty(false);
  }, [issues, selectedId, selectedIssue]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    async function loadImages() {
      const next = new Map<string, string>();
      for (const image of draft?.image_attachments || []) {
        const blob = await getImageBlob(image.blob_key);
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next.set(image.id, url);
      }
      if (!cancelled) setImageUrls(next);
    }
    void loadImages();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [draft?.id, draft?.image_attachments]);

  const linkedRecords = useMemo(() => {
    const ids = new Set(draft?.linked_record_ids || []);
    return records.filter((record) => ids.has(record.id));
  }, [draft?.linked_record_ids, records]);

  const candidateRecords = useMemo(() => {
    const normalized = recordQuery.trim().toLowerCase();
    if (!normalized || !draft) return [];
    const linked = new Set(draft.linked_record_ids);
    return records
      .filter((record) => !linked.has(record.id))
      .filter((record) => recordSearchText(record).includes(normalized))
      .slice(0, 8);
  }, [draft, recordQuery, records]);

  async function handleCreate() {
    const issue = await onCreateIssue();
    if (!issue) return;
    setIssueListMode("active");
    clearCachedIssueDraft(issue.id);
    setSelectedId(issue.id);
    setDraft(issue);
    setDraftDirty(false);
    setPreviewMode("editor");
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await onSaveIssue(draft);
      if (saved) {
        clearCachedIssueDraft(saved.id);
        setDraft(saved);
        setSelectedId(saved.id);
        setDraftDirty(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveIssue() {
    if (!draft) return;
    clearCachedIssueDraft(draft.id);
    const archivedDraft: CGMPIssueNote = {
      ...draft,
      status: "archived",
      pinned: false,
      updated_at: new Date().toISOString(),
    };
    setSaving(true);
    setDraft(archivedDraft);
    setDraftDirty(false);
    setIssueListMode("archived");
    setSelectedId(archivedDraft.id);
    try {
      await onArchiveIssue(archivedDraft.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreIssue() {
    if (!draft) return;
    const restored: CGMPIssueNote = {
      ...draft,
      status: "open",
      updated_at: new Date().toISOString(),
    };
    clearCachedIssueDraft(restored.id);
    setSaving(true);
    try {
      const saved = await onSaveIssue(restored);
      if (saved) {
        setIssueListMode("active");
        setSelectedId(saved.id);
        setDraft(saved);
        setDraftDirty(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(patch: Partial<CGMPIssueNote>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      writeCachedIssueDraft(next);
      return next;
    });
    setDraftDirty(true);
  }

  function addLinkedRecord(recordId: string) {
    if (!draft) return;
    const nextIds = Array.from(new Set([...draft.linked_record_ids, recordId]));
    updateDraft({ linked_record_ids: nextIds });
    setRecordQuery("");
  }

  function removeLinkedRecord(recordId: string) {
    if (!draft) return;
    updateDraft({ linked_record_ids: draft.linked_record_ids.filter((id) => id !== recordId) });
  }

  async function handleAddImages(files: File[]) {
    if (!draft || files.length === 0) return;
    const before = new Set(draft.image_attachments.map((image) => image.id));
    const updated = await onAddImages(draft.id, files);
    if (!updated) return;
    const added = updated.image_attachments.filter((image) => !before.has(image.id));
    const markdown = added
      .map((image) => `![${image.ai_caption || image.filename || "image"}](cgmp-issue-image://${image.id})`)
      .join("\n");
    const body = markdown ? `${draft.body_markdown.trimEnd()}\n\n${markdown}`.trimStart() : draft.body_markdown;
    const next = { ...updated, body_markdown: body };
    const saved = await onSaveIssue(next);
    clearCachedIssueDraft((saved || next).id);
    setDraft(saved || next);
    setDraftDirty(false);
  }

  async function handleCaption(imageId: string) {
    if (!draft) return;
    setCaptioningId(imageId);
    try {
      const updated = await onCaptionImage(draft.id, imageId);
      if (updated) {
        clearCachedIssueDraft(updated.id);
        setDraft(updated);
        setDraftDirty(false);
      }
    } finally {
      setCaptioningId("");
    }
  }

  async function toggleMarkdownTask(field: IssueMarkdownField, lineIndex: number) {
    const current = draftRef.current;
    if (!current || saving) return;
    const lines = String(current[field] || "").split(/\n/);
    const line = lines[lineIndex] || "";
    if (!/^- \[[ xX]\]\s+/.test(line)) return;

    lines[lineIndex] = /^- \[[xX]\]/.test(line) ? line.replace(/^- \[[xX]\]/, "- [ ]") : line.replace(/^- \[ \]/, "- [x]");

    const next: CGMPIssueNote = {
      ...current,
      [field]: lines.join("\n"),
      updated_at: new Date().toISOString(),
    };

    writeCachedIssueDraft(next);
    setDraft(next);
    setDraftDirty(true);
    setSaving(true);
    try {
      const saved = await onSaveIssue(next);
      if (saved) {
        clearCachedIssueDraft(saved.id);
        setDraft(saved);
        setSelectedId(saved.id);
        setDraftDirty(false);
      }
    } finally {
      setSaving(false);
    }
  }

  const statusMeta = draft ? getStatusMeta(draft.status) : STATUS_OPTIONS[0];
  const renderedPreview: ReactNode[] = draft
    ? [
        ...(draft.context_markdown
          ? [
              <h3 key="context-heading" className="mt-1 text-lg font-semibold text-[var(--text)]">
                Context
              </h3>,
              ...renderMarkdown(draft.context_markdown, imageUrls, draft.image_attachments, {
                onToggleTask: (lineIndex) => void toggleMarkdownTask("context_markdown", lineIndex),
              }),
            ]
          : []),
        ...renderMarkdown(draft.body_markdown, imageUrls, draft.image_attachments, {
          onToggleTask: (lineIndex) => void toggleMarkdownTask("body_markdown", lineIndex),
        }),
      ]
    : [];

  return (
    <section className="space-y-4">
      <div className={panelClass}>
        <SectionHeading
          eyebrow="Issue Note"
          title="育てるIssue Note"
          description="通常メモとは別に、断片を束ねて長く育てるノートです。"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleCreate} className={primaryButtonClass}>
            新規Issue
          </button>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Issue検索"
            className={`${fieldClass} mt-0 min-w-[180px] flex-1`}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.5fr)]">
        <div className={`${panelClass} space-y-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-[var(--text)]">
              {issueListMode === "archived" ? "Archive一覧" : "Issue一覧"}
            </h2>
            <Badge compact>{filteredIssues.length}件</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[color:var(--border)] bg-[var(--card-soft)] p-1">
            <button
              type="button"
              onClick={() => setIssueListMode("active")}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                issueListMode === "active" ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--card)]"
              }`}
            >
              Active {activeIssueCount}
            </button>
            <button
              type="button"
              onClick={() => setIssueListMode("archived")}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                issueListMode === "archived" ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--card)]"
              }`}
            >
              Archive {archivedIssueCount}
            </button>
          </div>
          {filteredIssues.length === 0 ? (
            <div className={softPanelClass}>
              {issueListMode === "archived" ? "アーカイブ済みのIssue Noteはありません。" : "Issue Noteはまだありません。"}
            </div>
          ) : (
            filteredIssues.map((issue) => {
              const meta = getStatusMeta(issue.status);
              return (
                <button
                  type="button"
                  key={issue.id}
                  onClick={() => {
                    setSelectedId(issue.id);
                    setPreviewMode("viewer");
                  }}
                  className={`w-full rounded-2xl border p-3 text-left transition ${
                    issue.id === draft?.id
                      ? "border-[color:var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[color:var(--border)] bg-[var(--card-soft)] hover:border-[color:var(--accent)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">
                      {issue.pinned ? "★ " : ""}
                      {issue.title}
                    </span>
                    <Badge compact tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{issue.purpose || issue.body_markdown || "目的未設定"}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--subtle)]">
                    <span>links {issue.linked_record_ids.length}</span>
                    <span>images {issue.image_attachments.length}</span>
                    <span>{formatJstDateTime(issue.updated_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className={`${panelClass} space-y-4`}>
          {!draft ? (
            <div className={softPanelClass}>左の一覧からIssue Noteを選ぶか、新規作成してください。</div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--accent)]">
                    {previewMode === "viewer" ? "Viewer" : "Editor"}
                  </div>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--text)]">{draft.title || "Untitled Issue"}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {previewMode === "viewer" ? (
                    <>
                      {draft.status === "archived" ? (
                        <button type="button" disabled={saving} onClick={() => void handleRestoreIssue()} className={primaryButtonClass}>
                          {saving ? "復元中..." : "復元"}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setPreviewMode("editor")} className={draft.status === "archived" ? secondaryButtonClass : primaryButtonClass}>
                        編集
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => updateDraft({ pinned: !draft.pinned })} className={secondaryButtonClass}>
                        {draft.pinned ? "ピン解除" : "ピン留め"}
                      </button>
                      <button type="button" disabled={saving} onClick={handleSave} className={primaryButtonClass}>
                        {saving ? "保存中..." : "保存"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewMode("viewer")}
                    className={previewMode === "viewer" ? primaryButtonClass : secondaryButtonClass}
                  >
                    Viewer
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("editor")}
                    className={previewMode === "editor" ? primaryButtonClass : secondaryButtonClass}
                  >
                    Editor
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {draftDirty ? <Badge compact tone="amber">未保存</Badge> : null}
                  <Badge compact tone={statusMeta.tone}>{statusMeta.label}</Badge>
                </div>
              </div>

              {previewMode === "viewer" ? (
                <div className="space-y-4">
                  <div className={`${softPanelClass} space-y-3`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {draft.pinned ? <Badge compact tone="amber">Pinned</Badge> : null}
                      <Badge compact tone={statusMeta.tone}>{statusMeta.label}</Badge>
                      <span className="text-xs text-[var(--muted)]">updated {formatJstDateTime(draft.updated_at)}</span>
                    </div>
                    {draft.purpose ? (
                      <p className="text-sm leading-6 text-[var(--text)]">{draft.purpose}</p>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">目的はまだ書かれていません。</p>
                    )}
                  </div>
                  <div className={`${softPanelClass} min-h-[220px]`}>{renderedPreview}</div>
                  {linkedRecords.length > 0 ? (
                    <div className={`${softPanelClass} space-y-2`}>
                      <h3 className="text-base font-semibold text-[var(--text)]">Linked records</h3>
                      {linkedRecords.map((record) => (
                        <button
                          key={record.id}
                          type="button"
                          onClick={() => onOpenRecord(record.id)}
                          className="w-full rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3 text-left hover:border-[color:var(--accent)]"
                        >
                          <div className="truncate text-sm font-semibold text-[var(--text)]">{record.title}</div>
                          <div className="line-clamp-2 text-xs text-[var(--muted)]">{record.summary}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--text)]">Title</span>
                      <input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} className={fieldClass} />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--text)]">Status</span>
                      <select
                        value={draft.status}
                        onChange={(event) => updateDraft({ status: event.target.value as CGMPIssueNoteStatus })}
                        className={`${fieldClass} min-w-[140px]`}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-sm font-semibold text-[var(--text)]">Purpose</span>
                    <textarea
                      value={draft.purpose}
                      onChange={(event) => updateDraft({ purpose: event.target.value })}
                      className={`${textareaClass} min-h-[84px]`}
                      placeholder="このIssue Noteで何を育てたいか"
                    />
                  </label>

                  <div className="grid gap-3">
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--text)]">Context markdown</span>
                      <textarea
                        value={draft.context_markdown}
                        onChange={(event) => updateDraft({ context_markdown: event.target.value })}
                        className={`${textareaClass} min-h-[110px] font-mono`}
                        placeholder="背景、前提、関連する論点"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold text-[var(--text)]">Body markdown</span>
                      <textarea
                        value={draft.body_markdown}
                        onChange={(event) => updateDraft({ body_markdown: event.target.value })}
                        className={`${textareaClass} min-h-[220px] font-mono`}
                        placeholder="# 見出し&#10;- 箇条書き&#10;- [ ] チェック"
                      />
                    </label>
                  </div>

                  <div className={`${softPanelClass} space-y-3`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-[var(--text)]">画像</h3>
                      <div>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            const files = Array.from(event.target.files || []);
                            event.currentTarget.value = "";
                            void handleAddImages(files);
                          }}
                        />
                        <button type="button" onClick={() => imageInputRef.current?.click()} className={secondaryButtonClass}>
                          画像追加
                        </button>
                      </div>
                    </div>
                    {draft.image_attachments.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">まだ画像はありません。</p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {draft.image_attachments.map((image) => {
                          const url = imageUrls.get(image.id);
                          return (
                            <div key={image.id} className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[var(--card)]">
                              {url ? <img src={url} alt={image.ai_caption || image.filename || "Issue image"} className="h-40 w-full object-cover" /> : null}
                              <div className="space-y-2 p-3">
                                <p className="text-sm font-semibold text-[var(--text)]">{image.ai_caption || image.filename || image.id}</p>
                                <button
                                  type="button"
                                  disabled={captioningId === image.id}
                                  onClick={() => void handleCaption(image.id)}
                                  className={secondaryButtonClass}
                                >
                                  {captioningId === image.id ? "解析中..." : "AI caption"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className={`${softPanelClass} space-y-3`}>
                    <h3 className="text-base font-semibold text-[var(--text)]">Linked records</h3>
                    <input
                      value={recordQuery}
                      onChange={(event) => setRecordQuery(event.target.value)}
                      placeholder="既存recordを検索してリンク"
                      className={fieldClass}
                    />
                    {candidateRecords.length ? (
                      <div className="space-y-2">
                        {candidateRecords.map((record) => (
                          <button
                            key={record.id}
                            type="button"
                            onClick={() => addLinkedRecord(record.id)}
                            className="w-full rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3 text-left hover:border-[color:var(--accent)]"
                          >
                            <div className="text-sm font-semibold text-[var(--text)]">{record.title}</div>
                            <div className="text-xs text-[var(--muted)]">{record.summary}</div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {linkedRecords.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">リンクされたrecordはありません。</p>
                    ) : (
                      <div className="space-y-2">
                        {linkedRecords.map((record) => (
                          <div key={record.id} className="flex items-start gap-2 rounded-2xl border border-[color:var(--border)] bg-[var(--card)] p-3">
                            <button type="button" onClick={() => onOpenRecord(record.id)} className="min-w-0 flex-1 text-left">
                              <div className="truncate text-sm font-semibold text-[var(--text)]">{record.title}</div>
                              <div className="line-clamp-2 text-xs text-[var(--muted)]">{record.summary}</div>
                            </button>
                            <button type="button" onClick={() => removeLinkedRecord(record.id)} className="text-sm font-semibold text-[var(--danger)]">
                              解除
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="flex flex-wrap justify-between gap-2 border-t border-[color:var(--border)] pt-4">
                {draft.status === "archived" ? (
                  <button type="button" disabled={saving} onClick={() => void handleRestoreIssue()} className={primaryButtonClass}>
                    {saving ? "復元中..." : "アーカイブ解除"}
                  </button>
                ) : (
                  <button type="button" disabled={saving} onClick={() => void handleArchiveIssue()} className={secondaryButtonClass}>
                    {saving ? "Archive中..." : "Archive"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("このIssue Noteを完全に削除しますか？")) {
                      clearCachedIssueDraft(draft.id);
                      void onDeleteIssue(draft.id);
                    }
                  }}
                  className="rounded-2xl border border-[color:var(--danger)] bg-[var(--danger-soft)] px-4 py-2.5 text-sm font-semibold text-[var(--danger)]"
                >
                  削除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
