import { createHash } from "node:crypto";

import { backupRecordToDrive, listBackedUpRecordDetails } from "./drive-backup-server";
import { createGoogleCalendarEventFromRecord, createGoogleTaskFromRecord } from "./google-external-server";
import type { CGMPAnalysisResponse, CGMPRecord } from "./types";
import { buildRecordFromAnalysis } from "./utils";

export type ShortcutWebhookRequest = {
  text?: string;
  source?: string;
  timezone?: string;
  clientRequestId?: string;
};

export type ShortcutWebhookResult = {
  ok: boolean;
  message: string;
  action?: CGMPRecord["action"];
  title?: string;
  summary?: string;
  recordId?: string;
  date?: string;
  time?: string;
  confirmationText: string;
  errorCode?: string;
  source?: string;
  clientRequestId?: string;
  duplicate?: boolean;
};

function createShortcutRecordId(clientRequestId: string) {
  const hash = createHash("sha256").update(clientRequestId).digest("hex").slice(0, 24);
  return `shortcut_${hash}`;
}

function getRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (forwardedHost) {
    return `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost}`;
  }
  return url.origin;
}

function buildInputAtForTimezone(timezone: string) {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function summarizeRecord(record: CGMPRecord, duplicate = false): ShortcutWebhookResult {
  const target = record.date
    ? `${record.date}${record.time ? ` ${record.time}` : record.all_day ? " 終日" : ""}`
    : "";
  const destination =
    record.action === "calendar"
      ? "カレンダー"
      : record.action === "reminder"
        ? "Google Tasks"
        : "CGMPメモ";
  const confirmationText = duplicate
    ? `すでに登録済みです: ${record.title || "（無題）"}${target ? `（${target}）` : ""}`
    : `${record.title || "（無題）"}を${target ? `${target}に` : ""}${destination}へ登録しました。`;

  return {
    ok: true,
    message: duplicate ? "すでに登録済みです" : "登録しました",
    action: record.action,
    title: record.title,
    summary: record.summary,
    recordId: record.id,
    date: record.date,
    time: record.time,
    confirmationText,
    duplicate,
  };
}

async function analyzeTextViaExistingApi({
  request,
  text,
  timezone,
}: {
  request: Request;
  text: string;
  timezone: string;
}) {
  const response = await fetch(new URL("/api/analyze", getRequestOrigin(request)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      input_at: buildInputAtForTimezone(timezone),
      model: process.env.OPENAI_MODEL || "gpt-4.1-nano",
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as CGMPAnalysisResponse & {
    error?: string;
    detail?: string;
  };
  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.error || payload.detail || "AI_ANALYZE_FAILED");
  }
  return payload;
}

async function findExistingShortcutRecord(recordId: string) {
  try {
    const details = await listBackedUpRecordDetails();
    const item = details.records.find((record) => record.id === recordId);
    const record = item?.record as Partial<CGMPRecord> | undefined;
    return record?.id ? (record as CGMPRecord) : null;
  } catch (error) {
    console.debug("[cgmp:shortcut-webhook] duplicate lookup skipped", { recordId, error });
    return null;
  }
}

async function registerExternalIfNeeded(record: CGMPRecord) {
  if (record.action === "calendar") {
    const result = await createGoogleCalendarEventFromRecord(record);
    return {
      ...record,
      external_action_status: "registered",
      external_target: "calendar",
      external_registered_at: new Date().toISOString(),
      external_error: "",
      google_calendar_event_id: result.eventId || "",
      google_calendar_id: result.calendarId || "",
      google_calendar_updated_at: result.updatedAt || new Date().toISOString(),
    } satisfies CGMPRecord;
  }

  if (record.action === "reminder") {
    const result = await createGoogleTaskFromRecord(record);
    return {
      ...record,
      external_action_status: "registered",
      external_target: "reminder",
      external_registered_at: new Date().toISOString(),
      external_error: "",
      google_task_id: result.taskId || "",
      google_task_list_id: result.taskListId || "",
      google_task_status: result.status || "needsAction",
      google_task_updated_at: result.updatedAt || new Date().toISOString(),
    } satisfies CGMPRecord;
  }

  return record;
}

export async function createRecordFromShortcutWebhook({
  request,
  body,
}: {
  request: Request;
  body: ShortcutWebhookRequest;
}): Promise<ShortcutWebhookResult> {
  const text = String(body.text || "").trim();
  const source = String(body.source || "ios_shortcut").trim();
  const timezone = String(body.timezone || "Asia/Tokyo").trim() || "Asia/Tokyo";
  const clientRequestId = String(body.clientRequestId || "").trim();
  const receivedAt = new Date().toISOString();

  console.info("[cgmp:shortcut-webhook] received", {
    receivedAt,
    source,
    clientRequestId,
    text,
  });

  if (!text) {
    return {
      ok: false,
      message: "textが空です",
      errorCode: "TEXT_REQUIRED",
      confirmationText: "入力テキストが空です。ショートカット設定を確認してください。",
      source,
      clientRequestId,
    };
  }

  const recordId = clientRequestId ? createShortcutRecordId(clientRequestId) : undefined;
  if (recordId) {
    const existing = await findExistingShortcutRecord(recordId);
    if (existing) {
      console.info("[cgmp:shortcut-webhook] duplicate skipped", {
        clientRequestId,
        recordId,
      });
      return {
        ...summarizeRecord(existing, true),
        source,
        clientRequestId,
      };
    }
  }

  const analysisPayload = await analyzeTextViaExistingApi({ request, text, timezone });
  console.info("[cgmp:shortcut-webhook] analyzed", {
    clientRequestId,
    result: analysisPayload.result,
  });

  let record = buildRecordFromAnalysis({
    analysis: analysisPayload.result,
    rawInput: text,
    existingId: recordId,
    aiMeta: {
      model: analysisPayload.model,
      generated_at: analysisPayload.generated_at,
    },
  });

  try {
    record = await registerExternalIfNeeded(record);
  } catch (error) {
    record = {
      ...record,
      external_action_status: "failed",
      external_target: record.action === "calendar" ? "calendar" : record.action === "reminder" ? "reminder" : "",
      external_error: error instanceof Error ? error.message : "EXTERNAL_REGISTER_FAILED",
    };
    await backupRecordToDrive(record);
    console.error("[cgmp:shortcut-webhook] external register failed", {
      clientRequestId,
      recordId: record.id,
      error,
    });
    return {
      ok: false,
      message: "外部登録に失敗しました",
      errorCode: record.action === "calendar" ? "GOOGLE_CALENDAR_REGISTER_FAILED" : "GOOGLE_TASK_REGISTER_FAILED",
      action: record.action,
      title: record.title,
      summary: record.summary,
      recordId: record.id,
      date: record.date,
      time: record.time,
      confirmationText: `${record.title || "（無題）"}の解析と保存は完了しましたが、Google側の登録に失敗しました。CGMPアプリで確認してください。`,
      source,
      clientRequestId,
    };
  }

  const backup = await backupRecordToDrive(record);
  record = {
    ...record,
    drive_file_id: backup.driveFileId,
    backup_checksum: backup.checksum,
    last_backup_at: backup.backedUpAt,
    backup_status: "backed_up",
  };
  await backupRecordToDrive(record);

  console.info("[cgmp:shortcut-webhook] succeeded", {
    source,
    clientRequestId,
    recordId: record.id,
    action: record.action,
  });

  return {
    ...summarizeRecord(record),
    source,
    clientRequestId,
  };
}
