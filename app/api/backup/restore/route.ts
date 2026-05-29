import { NextResponse } from "next/server";

import { listBackedUpRecordDetails } from "@/lib/cgmp/drive-backup-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      ...(await listBackedUpRecordDetails()),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RESTORE_FAILED";
    const status = message.includes("NOT_CONFIGURED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
