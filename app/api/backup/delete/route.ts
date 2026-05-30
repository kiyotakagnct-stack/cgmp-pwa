import { NextResponse } from "next/server";

import { backupDeletedRecordToDrive } from "@/lib/cgmp/drive-backup-server";
import type { CGMPDeletedRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { tombstone?: CGMPDeletedRecord };
    if (!body.tombstone?.record_id || !body.tombstone.deleted_at) {
      return NextResponse.json({ ok: false, error: "TOMBSTONE_REQUIRED" }, { status: 400 });
    }
    const result = await backupDeletedRecordToDrive(body.tombstone);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "BACKUP_DELETE_FAILED",
      },
      { status: 500 }
    );
  }
}
