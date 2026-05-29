import { NextResponse } from "next/server";

import { backupRecordToDrive } from "@/lib/cgmp/drive-backup-server";
import type { CGMPRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { record?: CGMPRecord };
    if (!body.record?.id) {
      return NextResponse.json({ ok: false, error: "RECORD_REQUIRED" }, { status: 400 });
    }

    const result = await backupRecordToDrive(body.record);
    return NextResponse.json({
      ok: true,
      recordId: body.record.id,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BACKUP_RECORD_FAILED";
    const status = message.includes("NOT_CONFIGURED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
