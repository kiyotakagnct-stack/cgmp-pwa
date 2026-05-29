import { NextResponse } from "next/server";

import { backupRecordToDrive } from "@/lib/cgmp/drive-backup-server";
import type { CGMPRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { records?: CGMPRecord[] };
    const records = Array.isArray(body.records) ? body.records : [];
    const results = [];

    for (const record of records) {
      if (!record?.id) continue;
      try {
        results.push({
          ok: true,
          recordId: record.id,
          ...(await backupRecordToDrive(record)),
        });
      } catch (error) {
        results.push({
          ok: false,
          recordId: record.id,
          error: error instanceof Error ? error.message : "BACKUP_RECORD_FAILED",
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BACKUP_PROCESS_FAILED";
    const status = message.includes("NOT_CONFIGURED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
