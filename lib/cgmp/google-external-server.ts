import { getGoogleAccessToken } from "./drive-backup-server";
import type { CGMPGoogleTaskStatus, CGMPRecord } from "./types";

const TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const DEFAULT_TIMEZONE = "Asia/Tokyo";

type GoogleTaskList = {
  id: string;
  title?: string;
};

type GoogleTask = {
  id: string;
  title: string;
  status?: CGMPGoogleTaskStatus;
  updated?: string;
  selfLink?: string;
  webViewLink?: string;
};

type GoogleCalendarEvent = {
  id: string;
  htmlLink?: string;
  updated?: string;
};

async function googleJsonFetch<T>(url: string, init: RequestInit = {}) {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "GOOGLE_REQUEST_FAILED");
  }
  return payload as T;
}

function buildExternalNotes(record: CGMPRecord) {
  const lines = [
    record.summary || record.body || record.raw_input,
    record.body && record.body !== record.summary ? record.body : "",
    record.raw_input ? `原文: ${record.raw_input}` : "",
    (record.tags || []).length > 0 ? `Tags: ${(record.tags || []).map((tag) => `#${tag}`).join(" ")}` : "",
    `CGMP record: ${record.id}`,
  ].filter(Boolean);
  return lines.join("\n\n");
}

function normalizeRecordTitle(record: CGMPRecord) {
  return (record.title || record.summary || record.raw_input || "CGMP Task").trim().slice(0, 240);
}

function taskDueDate(record: CGMPRecord) {
  if (!record.date) return undefined;
  // Google Tasks stores due as a date-only value and discards the time portion.
  return `${record.date}T00:00:00.000Z`;
}

async function getPrimaryTaskListId() {
  if (process.env.GOOGLE_TASK_LIST_ID?.trim()) {
    return process.env.GOOGLE_TASK_LIST_ID.trim();
  }
  const payload = await googleJsonFetch<{ items?: GoogleTaskList[] }>(`${TASKS_API_BASE}/users/@me/lists?maxResults=100`);
  const lists = payload.items || [];
  const preferred = lists.find((list) => /^(My Tasks|マイタスク|Tasks|ToDo)$/i.test(list.title || ""));
  return preferred?.id || lists[0]?.id || "@default";
}

export async function createGoogleTaskFromRecord(record: CGMPRecord) {
  const taskListId = await getPrimaryTaskListId();
  const body = {
    title: normalizeRecordTitle(record),
    notes: buildExternalNotes(record),
    due: taskDueDate(record),
    status: "needsAction",
  };
  const task = await googleJsonFetch<GoogleTask>(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return {
    taskListId,
    taskId: task.id,
    status: task.status || "needsAction",
    updatedAt: task.updated || new Date().toISOString(),
    webViewLink: task.webViewLink || "",
  };
}

export async function updateGoogleTaskStatus({
  taskListId,
  taskId,
  status,
}: {
  taskListId: string;
  taskId: string;
  status: Exclude<CGMPGoogleTaskStatus, "">;
}) {
  const body =
    status === "completed"
      ? { status, completed: new Date().toISOString() }
      : { status };
  const task = await googleJsonFetch<GoogleTask>(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  );
  return {
    taskListId,
    taskId: task.id || taskId,
    status: task.status || status,
    updatedAt: task.updated || new Date().toISOString(),
  };
}

function addMinutes(date: string, time: string, minutes: number) {
  const [year, month, day] = date.split("-").map((part) => Number(part));
  const [hour, minute] = time.split(":").map((part) => Number(part));
  const startUtc = Date.UTC(year, month - 1, day, hour - 9, minute);
  const next = new Date(startUtc + Math.max(1, minutes) * 60 * 1000 + 9 * 60 * 60 * 1000);
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  const hh = String(next.getUTCHours()).padStart(2, "0");
  const mi = String(next.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map((part) => Number(part));
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function createGoogleCalendarEventFromRecord(record: CGMPRecord) {
  if (!record.date) {
    throw new Error("CALENDAR_DATE_REQUIRED");
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";
  const duration = Number.isFinite(Number(record.duration_minutes)) ? Number(record.duration_minutes) : 60;
  const isAllDay = record.all_day || !record.time;
  const start = isAllDay
    ? { date: record.date }
    : { dateTime: `${record.date}T${record.time}:00`, timeZone: DEFAULT_TIMEZONE };
  const end = isAllDay
    ? { date: addDays(record.date, 1) }
    : { dateTime: addMinutes(record.date, record.time, duration), timeZone: DEFAULT_TIMEZONE };

  const event = await googleJsonFetch<GoogleCalendarEvent>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: normalizeRecordTitle(record),
        description: buildExternalNotes(record),
        location: record.location || undefined,
        start,
        end,
      }),
    }
  );

  return {
    calendarId,
    eventId: event.id,
    htmlLink: event.htmlLink || "",
    updatedAt: event.updated || new Date().toISOString(),
  };
}
