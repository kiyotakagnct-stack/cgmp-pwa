import { NextResponse } from "next/server";

import { listBackedUpRecords } from "@/lib/cgmp/drive-backup-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      manifest: await listBackedUpRecords(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RESTORE_FAILED";
    const status = message.includes("NOT_CONFIGURED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
