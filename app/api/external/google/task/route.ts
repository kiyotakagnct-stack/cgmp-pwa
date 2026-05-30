import { NextResponse } from "next/server";

import { createGoogleTaskFromRecord, updateGoogleTaskStatus } from "@/lib/cgmp/google-external-server";
import type { CGMPGoogleTaskStatus, CGMPRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { record?: CGMPRecord };
    if (!body.record?.id) {
      return NextResponse.json({ ok: false, error: "RECORD_REQUIRED" }, { status: 400 });
    }
    const result = await createGoogleTaskFromRecord(body.record);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "GOOGLE_TASK_CREATE_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      taskListId?: string;
      taskId?: string;
      status?: CGMPGoogleTaskStatus;
    };
    if (!body.taskListId || !body.taskId || (body.status !== "needsAction" && body.status !== "completed")) {
      return NextResponse.json({ ok: false, error: "TASK_STATUS_REQUEST_INVALID" }, { status: 400 });
    }
    const result = await updateGoogleTaskStatus({
      taskListId: body.taskListId,
      taskId: body.taskId,
      status: body.status,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "GOOGLE_TASK_UPDATE_FAILED",
      },
      { status: 500 }
    );
  }
}
