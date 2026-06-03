import { createHash } from "node:crypto";

import { createGoogleCalendarEventFromRecord, createGoogleTaskFromRecord } from "./google-external-server";
import type { CGMPAnalysisResponse, CGMPRecord } from "./types";
import { buildRecordFromAnalysis } from "./utils";
import { backupRecordToDrive, listBackedUpRecordDetails } from "./drive-backup-server";

export type ShortcutWebhookRequest = {
  text?: string;
  source?: string;
  timezone?: string;
  clientRequestId?: string;
  debug?: boolean;
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
  debugTrace?: ShortcutWebhookDebugTrace;
};

function createWebhookTracer(enabled: boolean) {
  const base = Date.now();
  const steps: ShortcutWebhookTraceStep[] = [];

  function start(id: string, label: string, detail?: string) {
    if (!enabled) {
      return {
        success: () => undefined,
        error: () => undefined,
        skipped: () => undefined,
      };
    }
    const step: ShortcutWebhookTraceStep = {
      id,
      label,
      status: "running",
      startedAt: Date.now() - base,
      detail,
    };
    steps.push(step);
    return {
      success(nextDetail?: string) {
        step.status = "success";
        step.endedAt = Date.now() - base;
        step.elapsedMs = step.endedAt - step.startedAt;
        if (nextDetail) step.detail = nextDetail;
      },
      error(error: unknown) {
        step.status = "error";
        step.endedAt = Date.now() - base;
        step.elapsedMs = step.endedAt - step.startedAt;
        step.error = error instanceof Error ? error.message : String(error);
      },
      skipped(nextDetail?: string) {
        step.status = "skipped";
        step.endedAt = Date.now() - base;
        step.elapsedMs = step.endedAt - step.startedAt;
        if (nextDetail) step.detail = nextDetail;
      },
    };
  }

  function finish(): ShortcutWebhookDebugTrace | undefined {
    if (!enabled) return undefined;
    return {
      enabled: true,
      totalElapsedMs: Date.now() - base,
      steps,
    };
  }

  return { start, finish };
}

function withTrace<T extends ShortcutWebhookResult>(
  result: T,
  trace: ShortcutWebhookDebugTrace | undefined
): T {
  return trace ? { ...result, debugTrace: trace } : result;
}

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

function isDriveDuplicateCheckEnabled() {
  return String(process.env.SHORTCUT_WEBHOOK_DEDUPE || "").trim().toLowerCase() === "drive";
}

async function findExistingShortcutRecord(recordId: string) {
  if (!isDriveDuplicateCheckEnabled()) {
    return null;
  }

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

function applyDriveBackupMetadata(
  record: CGMPRecord,
  backup: Awaited<ReturnType<typeof backupRecordToDrive>>
): CGMPRecord {
  return {
    ...record,
    drive_file_id: backup.driveFileId,
    backup_checksum: backup.checksum,
    last_backup_at: backup.backedUpAt,
    backup_status: "backed_up",
    backup_retry_count: 0,
    backup_last_error: "",
    backup_next_retry_at: "",
  };
}

async function settleWithTiming<T>(promise: Promise<T>) {
  const startedAt = Date.now();
  try {
    return {
      status: "fulfilled" as const,
      value: await promise,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (reason) {
    return {
      status: "rejected" as const,
      reason,
      elapsedMs: Date.now() - startedAt,
    };
  }
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
  const tracer = createWebhookTracer(body.debug === true);
  const receivedStep = tracer.start("received", "Webhook受信", `source=${source}`);
  receivedStep.success(clientRequestId ? `source=${source} / request=${clientRequestId}` : `source=${source}`);

  console.info("[cgmp:shortcut-webhook] received", {
    receivedAt,
    source,
    clientRequestId,
    text,
  });

  if (!text) {
    const validationStep = tracer.start("validation", "入力検証");
    validationStep.error("text is empty");
    return withTrace(
      {
        ok: false,
        message: "textが空です",
        errorCode: "TEXT_REQUIRED",
        confirmationText: "入力テキストが空です。ショートカット設定を確認してください。",
        source,
        clientRequestId,
      },
      tracer.finish()
    );
  }

  const recordId = clientRequestId ? createShortcutRecordId(clientRequestId) : undefined;
  if (recordId) {
    const duplicateStep = tracer.start("duplicate_lookup", "重複チェック", recordId);
    if (isDriveDuplicateCheckEnabled()) {
      const existing = await findExistingShortcutRecord(recordId);
      if (existing) {
        duplicateStep.success("既存recordあり。二重登録を回避しました。");
        console.info("[cgmp:shortcut-webhook] duplicate skipped", {
          clientRequestId,
          recordId,
        });
        return withTrace(
          {
            ...summarizeRecord(existing, true),
            source,
            clientRequestId,
          },
          tracer.finish()
        );
      }
      duplicateStep.success("重複なし");
    } else {
      duplicateStep.skipped("高速化のためスキップ。必要なら SHORTCUT_WEBHOOK_DEDUPE=drive で有効化。");
    }
  }

  const aiStep = tracer.start("ai_analyze", "AI解析", "既存 /api/analyze を使用");
  let analysisPayload: Awaited<ReturnType<typeof analyzeTextViaExistingApi>>;
  try {
    analysisPayload = await analyzeTextViaExistingApi({ request, text, timezone });
    aiStep.success(
      `${analysisPayload.result?.action || "unknown"} / ${analysisPayload.result?.title || "無題"}${
        analysisPayload.result?.date ? ` / ${analysisPayload.result.date}` : ""
      }`
    );
  } catch (error) {
    aiStep.error(error);
    console.error("[cgmp:shortcut-webhook] analyze failed", {
      clientRequestId,
      error,
    });
    return withTrace(
      {
        ok: false,
        message: "解析に失敗しました",
        errorCode: "AI_ANALYZE_FAILED",
        confirmationText: "解析に失敗しました。CGMPアプリで確認してください。",
        source,
        clientRequestId,
      },
      tracer.finish()
    );
  }
  console.info("[cgmp:shortcut-webhook] analyzed", {
    clientRequestId,
    result: analysisPayload.result,
  });

  const buildStep = tracer.start("record_build", "record生成", "AI結果からCGMPRecordを作成");
  const record = buildRecordFromAnalysis({
    analysis: analysisPayload.result,
    rawInput: text,
    existingId: recordId,
    aiMeta: {
      model: analysisPayload.model,
      generated_at: analysisPayload.generated_at,
    },
  });
  buildStep.success(`${record.action} / ${record.id}`);

  const externalLabel =
    record.action === "calendar"
      ? "Google Calendar登録"
      : record.action === "reminder"
        ? "Google Tasks登録"
        : "外部登録なし";
  const externalStep = tracer.start("external_register", externalLabel, "Drive初回バックアップと並列");
  const initialBackupStep = tracer.start("initial_drive_backup", "Drive初回バックアップ", "Google登録と並列");
  const [externalResult, initialBackupResult] = await Promise.all([
    settleWithTiming(registerExternalIfNeeded(record)),
    settleWithTiming(backupRecordToDrive(record)),
  ]);

  if (externalResult.status === "fulfilled") {
    if (record.action === "calendar") {
      externalStep.success(`Calendar registered / ${externalResult.elapsedMs}ms`);
    } else if (record.action === "reminder") {
      externalStep.success(`Task registered / ${externalResult.elapsedMs}ms`);
    } else {
      externalStep.skipped(`action=${record.action} のため外部登録なし / ${externalResult.elapsedMs}ms`);
    }
  } else {
    externalStep.error(externalResult.reason);
  }

  if (initialBackupResult.status === "fulfilled") {
    initialBackupStep.success(`Drive backup ok / ${initialBackupResult.elapsedMs}ms`);
  } else {
    initialBackupStep.error(initialBackupResult.reason);
  }

  console.info("[cgmp:shortcut-webhook] parallel phase completed", {
    clientRequestId,
    recordId: record.id,
    externalOk: externalResult.status === "fulfilled",
    initialBackupOk: initialBackupResult.status === "fulfilled",
    externalElapsedMs: externalResult.elapsedMs,
    initialBackupElapsedMs: initialBackupResult.elapsedMs,
  });

  if (externalResult.status === "rejected") {
    let failedRecord: CGMPRecord = {
      ...record,
      external_action_status: "failed",
      external_target: record.action === "calendar" ? "calendar" : record.action === "reminder" ? "reminder" : "",
      external_error: externalResult.reason instanceof Error ? externalResult.reason.message : "EXTERNAL_REGISTER_FAILED",
    };

    if (initialBackupResult.status === "fulfilled") {
      failedRecord = applyDriveBackupMetadata(failedRecord, initialBackupResult.value);
    }

    const failedBackupStep = tracer.start("failed_state_backup", "失敗状態のDrive保存", "外部登録失敗をrecordへ反映");
    try {
      const failedBackup = await backupRecordToDrive(failedRecord);
      failedRecord = applyDriveBackupMetadata(failedRecord, failedBackup);
      failedBackupStep.success("失敗状態をDriveへ保存しました");
    } catch (backupError) {
      failedBackupStep.error(backupError);
      console.error("[cgmp:shortcut-webhook] failed-state backup failed", {
        clientRequestId,
        recordId: record.id,
        backupError,
      });
    }

    console.error("[cgmp:shortcut-webhook] external register failed", {
      clientRequestId,
      recordId: record.id,
      error: externalResult.reason,
    });
    return withTrace(
      {
        ok: false,
        message: "外部登録に失敗しました",
        errorCode: failedRecord.action === "calendar" ? "GOOGLE_CALENDAR_REGISTER_FAILED" : "GOOGLE_TASK_REGISTER_FAILED",
        action: failedRecord.action,
        title: failedRecord.title,
        summary: failedRecord.summary,
        recordId: failedRecord.id,
        date: failedRecord.date,
        time: failedRecord.time,
        confirmationText: `${failedRecord.title || "（無題）"}の解析と保存は完了しましたが、Google側の登録に失敗しました。CGMPアプリで確認してください。`,
        source,
        clientRequestId,
      },
      tracer.finish()
    );
  }

  let finalRecord = externalResult.value;
  if (initialBackupResult.status === "fulfilled") {
    finalRecord = applyDriveBackupMetadata(finalRecord, initialBackupResult.value);
  } else {
    console.error("[cgmp:shortcut-webhook] initial backup failed", {
      clientRequestId,
      recordId: record.id,
      error: initialBackupResult.reason,
    });
  }

  const finalBackupStep = tracer.start("final_drive_backup", "外部ID反映バックアップ", "Google登録結果をrecordへ反映");
  try {
    const finalBackup = await backupRecordToDrive(finalRecord);
    finalRecord = applyDriveBackupMetadata(finalRecord, finalBackup);
    finalBackupStep.success("Drive backup ok");
  } catch (error) {
    finalBackupStep.error(error);
    console.error("[cgmp:shortcut-webhook] final backup failed", {
      clientRequestId,
      recordId: finalRecord.id,
      error,
    });
    return withTrace(
      {
        ok: false,
        message: "バックアップに失敗しました",
        errorCode: "DRIVE_BACKUP_FAILED",
        action: finalRecord.action,
        title: finalRecord.title,
        summary: finalRecord.summary,
        recordId: finalRecord.id,
        date: finalRecord.date,
        time: finalRecord.time,
        confirmationText: `${finalRecord.title || "（無題）"}のGoogle登録は完了しましたが、CGMPへの保存に失敗しました。CGMPアプリで確認してください。`,
        source,
        clientRequestId,
      },
      tracer.finish()
    );
  }

  console.info("[cgmp:shortcut-webhook] succeeded", {
    source,
    clientRequestId,
    recordId: finalRecord.id,
    action: finalRecord.action,
  });

  return withTrace(
    {
      ...summarizeRecord(finalRecord),
      source,
      clientRequestId,
    },
    tracer.finish()
  );
}
