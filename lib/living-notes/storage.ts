import type { Note, NoteChild, NoteChildUpdate, Thread } from "./types";

const STORAGE_KEY = "living-notes:v0.1";

function hasWindow() {
  return typeof window !== "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function isNoteChildUpdate(value: unknown): value is NoteChildUpdate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.childId === "string" &&
    (value.source === "user" || value.source === "ai") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.dateKey === "string" &&
    typeof value.timeKey === "string" &&
    isOptionalStringArray(value.suggestedTags) &&
    isOptionalStringArray(value.confirmedTags)
  );
}

function isNoteChild(value: unknown): value is NoteChild {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.parentNoteId === "string" &&
    (value.type === "ai_reply" ||
      value.type === "user_reply" ||
      value.type === "photo" ||
      value.type === "tag" ||
      value.type === "revision") &&
    (value.status === "bud" || value.status === "branch") &&
    (value.source === "ai" || value.source === "user") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.dateKey === "string" &&
    typeof value.timeKey === "string" &&
    isOptionalStringArray(value.suggestedTags) &&
    isOptionalStringArray(value.confirmedTags) &&
    Array.isArray(value.updates) &&
    value.updates.every(isNoteChildUpdate)
  );
}

function isNote(value: unknown): value is Note {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    value.kind === "note" &&
    value.source === "user" &&
    typeof value.content === "string" &&
    typeof value.previewTitle === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.dateKey === "string" &&
    typeof value.timeKey === "string" &&
    isOptionalStringArray(value.suggestedTags) &&
    isOptionalStringArray(value.confirmedTags) &&
    Array.isArray(value.children) &&
    value.children.every(isNoteChild)
  );
}

function isThread(value: unknown): value is Thread {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.notes) &&
    value.notes.every(isNote)
  );
}

function isThreadArray(value: unknown): value is Thread[] {
  return Array.isArray(value) && value.every(isThread);
}

function normalizeThread(thread: Thread): Thread {
  return {
    ...thread,
    notes: thread.notes.map((note) => ({
      ...note,
      suggestedTags: note.suggestedTags ?? [],
      confirmedTags: note.confirmedTags ?? [],
      children: note.children.map((child) => ({
        ...child,
        suggestedTags: child.suggestedTags ?? [],
        confirmedTags: child.confirmedTags ?? [],
        updates: child.updates.map((update) => ({
          ...update,
          suggestedTags: update.suggestedTags ?? [],
          confirmedTags: update.confirmedTags ?? [],
        })),
      })),
    })),
  };
}

function normalizeThreads(threads: Thread[]) {
  return threads.map(normalizeThread);
}

export function loadThreads(): Thread[] {
  if (!hasWindow()) {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isThreadArray(parsed) ? normalizeThreads(parsed) : [];
  } catch {
    return [];
  }
}

export function saveThreads(threads: Thread[]) {
  if (!hasWindow()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

export function exportThreadsAsJson(threads: Thread[] = loadThreads()) {
  return JSON.stringify(threads, null, 2);
}

export function importThreadsFromJson(json: string) {
  const parsed: unknown = JSON.parse(json);
  if (!isThreadArray(parsed)) {
    throw new Error("Invalid thread JSON");
  }

  const normalized = normalizeThreads(parsed);
  saveThreads(normalized);
  return normalized;
}
