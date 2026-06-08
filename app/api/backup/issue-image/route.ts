import { NextResponse } from "next/server";

import { backupIssueNoteImageToDrive } from "@/lib/cgmp/drive-backup-server";
import type { CGMPIssueNoteImage } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const issueId = String(formData.get("issueId") || "").trim();
    const imageJson = String(formData.get("image") || "").trim();
    const preview = formData.get("preview");

    if (!issueId) {
      return NextResponse.json({ ok: false, error: "ISSUE_ID_REQUIRED" }, { status: 400 });
    }
    if (!imageJson) {
      return NextResponse.json({ ok: false, error: "ISSUE_IMAGE_REQUIRED" }, { status: 400 });
    }
    if (!(preview instanceof Blob) || preview.size === 0) {
      return NextResponse.json({ ok: false, error: "PREVIEW_BLOB_REQUIRED" }, { status: 400 });
    }

    const image = JSON.parse(imageJson) as CGMPIssueNoteImage;
    const result = await backupIssueNoteImageToDrive({
      issueId,
      image,
      preview: Buffer.from(await preview.arrayBuffer()),
    });

    return NextResponse.json({
      ok: true,
      issueId,
      imageId: image.id,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ISSUE_IMAGE_BACKUP_FAILED";
    const status = message.includes("NOT_CONFIGURED") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
