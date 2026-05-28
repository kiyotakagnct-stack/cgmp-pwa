import type { NoteChild, NoteChildUpdate, Note, Thread } from "./types";

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `id_${Math.random().toString(36).slice(2, 11)}`;
}

export function getNowStamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    iso: now.toISOString(),
    dateKey: `${map.year}-${map.month}-${map.day}`,
    timeKey: `${map.hour}:${map.minute}`,
  };
}

export function makePreviewTitle(content: string, maxLength = 30) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Untitled";
  }

  const slice = normalized.slice(0, maxLength).trim();
  return slice || "Untitled";
}

export function makeThreadFallbackTitle(content: string) {
  return makePreviewTitle(content, 28);
}

export function createNote({
  threadId,
  content,
}: {
  threadId: string;
  content: string;
}): Note {
  const stamp = getNowStamp();
  const previewTitle = makePreviewTitle(content, 36);

  return {
    id: createId(),
    threadId,
    kind: "note",
    source: "user",
    content,
    previewTitle,
    createdAt: stamp.iso,
    updatedAt: stamp.iso,
    dateKey: stamp.dateKey,
    timeKey: stamp.timeKey,
    suggestedTags: [],
    confirmedTags: [],
    children: [],
  };
}

export function createNoteChild({
  parentNoteId,
  type,
  source,
  content,
  status,
  suggestedTags = [],
  promotedReason,
}: {
  parentNoteId: string;
  type: NoteChild["type"];
  source: "ai" | "user";
  content: string;
  status: "bud" | "branch";
  suggestedTags?: string[];
  promotedReason?: "manual" | "replied" | "edited";
}): NoteChild {
  const stamp = getNowStamp();

  return {
    id: createId(),
    parentNoteId,
    type,
    status,
    source,
    content,
    previewTitle: makePreviewTitle(content, 36),
    createdAt: stamp.iso,
    updatedAt: stamp.iso,
    dateKey: stamp.dateKey,
    timeKey: stamp.timeKey,
    suggestedTags,
    confirmedTags: [],
    promotedReason,
    updates: [],
  };
}

export function createNoteUpdate({
  childId,
  source,
  content,
  suggestedTags = [],
  confirmedTags = [],
}: {
  childId: string;
  source: "user" | "ai";
  content: string;
  suggestedTags?: string[];
  confirmedTags?: string[];
}): NoteChildUpdate {
  const stamp = getNowStamp();

  return {
    id: createId(),
    childId,
    source,
    content,
    createdAt: stamp.iso,
    updatedAt: stamp.iso,
    dateKey: stamp.dateKey,
    timeKey: stamp.timeKey,
    suggestedTags,
    confirmedTags,
  };
}

export function touchThread(thread: Thread) {
  const stamp = getNowStamp();
  return {
    ...thread,
    updatedAt: stamp.iso,
  };
}
