import { NextResponse } from "next/server";

import { backupIssueNoteToDrive } from "@/lib/cgmp/drive-backup-server";
import type { CGMPIssueNote } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { issue?: CGMPIssueNote };
    if (!body.issue?.id) {
      return NextResponse.json({ ok: false, error: "ISSUE_NOTE_REQUIRED" }, { status: 400 });
    }

    const result = await backupIssueNoteToDrive(body.issue);
    return NextResponse.json({
      ok: true,
      issueId: body.issue.id,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BACKUP_ISSUE_NOTE_FAILED";
    const status = message.includes("NOT_CONFIGURED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
