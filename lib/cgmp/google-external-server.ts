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
  due?: string;
  updated?: string;
  selfLink?: string;
  webViewLink?: string;
};

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  updated?: string;
  status?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
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

function parseGoogleTaskDueDate(value: string | undefined) {
  if (!value) return "";
  const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export async function updateGoogleTaskFromRecord(record: CGMPRecord) {
  if (!record.google_task_id || !record.google_task_list_id) {
    throw new Error("GOOGLE_TASK_ID_REQUIRED");
  }
  const task = await googleJsonFetch<GoogleTask>(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(record.google_task_list_id)}/tasks/${encodeURIComponent(record.google_task_id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        title: normalizeRecordTitle(record),
        notes: buildExternalNotes(record),
        due: taskDueDate(record),
      }),
    }
  );
  return {
    taskListId: record.google_task_list_id,
    taskId: task.id || record.google_task_id,
    status: task.status || record.google_task_status || "needsAction",
    updatedAt: task.updated || new Date().toISOString(),
  };
}

export async function getGoogleTaskStatus({
  taskListId,
  taskId,
}: {
  taskListId: string;
  taskId: string;
}) {
  const task = await googleJsonFetch<GoogleTask>(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`
  );
  return {
    taskListId,
    taskId: task.id || taskId,
    status: task.status || "needsAction",
    dueDate: parseGoogleTaskDueDate(task.due),
    updatedAt: task.updated || new Date().toISOString(),
  };
}

export async function deleteGoogleTask({
  taskListId,
  taskId,
}: {
  taskListId: string;
  taskId: string;
}) {
  await googleJsonFetch<Record<string, never>>(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" }
  );
  return { taskListId, taskId };
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

function parseGoogleDateTime(value: string | undefined) {
  if (!value) return { date: "", time: "" };
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) return { date: match[1], time: match[2] };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`,
    time: `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function minutesBetween(start: string | undefined, end: string | undefined) {
  if (!start || !end) return 0;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return 0;
  return Math.max(1, Math.round((endTime - startTime) / 60000));
}

function extractCalendarEventFields(event: GoogleCalendarEvent) {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const parsedStart = allDay
    ? { date: event.start?.date || "", time: "" }
    : parseGoogleDateTime(event.start?.dateTime);
  return {
    title: event.summary || "",
    location: event.location || "",
    date: parsedStart.date,
    time: parsedStart.time,
    allDay,
    durationMinutes: allDay ? 0 : minutesBetween(event.start?.dateTime, event.end?.dateTime),
  };
}

export async function createGoogleCalendarEventFromRecord(record: CGMPRecord) {
  if (!record.date) {
    throw new Error("CALENDAR_DATE_REQUIRED");
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";
  const event = await googleJsonFetch<GoogleCalendarEvent>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      body: JSON.stringify(buildCalendarEventBody(record)),
    }
  );

  return {
    calendarId,
    eventId: event.id,
    htmlLink: event.htmlLink || "",
    updatedAt: event.updated || new Date().toISOString(),
    event: extractCalendarEventFields(event),
  };
}

function buildCalendarEventBody(record: CGMPRecord) {
  if (!record.date) {
    throw new Error("CALENDAR_DATE_REQUIRED");
  }

  const duration = Number.isFinite(Number(record.duration_minutes)) ? Number(record.duration_minutes) : 60;
  const isAllDay = record.all_day || !record.time;
  const start = isAllDay
    ? { date: record.date }
    : { dateTime: `${record.date}T${record.time}:00`, timeZone: DEFAULT_TIMEZONE };
  const end = isAllDay
    ? { date: addDays(record.date, 1) }
    : { dateTime: addMinutes(record.date, record.time, duration), timeZone: DEFAULT_TIMEZONE };

  return {
    summary: normalizeRecordTitle(record),
    description: buildExternalNotes(record),
    location: record.location || undefined,
    start,
    end,
  };
}

export async function updateGoogleCalendarEventFromRecord(record: CGMPRecord) {
  if (!record.google_calendar_event_id || !record.google_calendar_id) {
    throw new Error("GOOGLE_CALENDAR_EVENT_ID_REQUIRED");
  }
  const event = await googleJsonFetch<GoogleCalendarEvent>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(record.google_calendar_id)}/events/${encodeURIComponent(record.google_calendar_event_id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(buildCalendarEventBody(record)),
    }
  );
  return {
    calendarId: record.google_calendar_id,
    eventId: event.id || record.google_calendar_event_id,
    htmlLink: event.htmlLink || "",
    updatedAt: event.updated || new Date().toISOString(),
    event: extractCalendarEventFields(event),
  };
}

export async function getGoogleCalendarEventStatus({
  calendarId,
  eventId,
}: {
  calendarId: string;
  eventId: string;
}) {
  const event = await googleJsonFetch<GoogleCalendarEvent>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  );
  return {
    calendarId,
    eventId: event.id || eventId,
    status: event.status || "confirmed",
    updatedAt: event.updated || new Date().toISOString(),
    event: extractCalendarEventFields(event),
  };
}

export async function deleteGoogleCalendarEvent({
  calendarId,
  eventId,
}: {
  calendarId: string;
  eventId: string;
}) {
  await googleJsonFetch<Record<string, never>>(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );
  return { calendarId, eventId };
}
