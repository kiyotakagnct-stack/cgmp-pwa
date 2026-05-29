import { NextResponse } from "next/server";

import { backupAttachmentToDrive } from "@/lib/cgmp/drive-backup-server";
import type { ImageAttachment } from "@/types/image";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const recordId = String(formData.get("recordId") || "").trim();
    const attachmentJson = String(formData.get("attachment") || "").trim();
    const preview = formData.get("preview");
    const thumbnail = formData.get("thumbnail");

    if (!recordId) {
      return NextResponse.json({ ok: false, error: "RECORD_ID_REQUIRED" }, { status: 400 });
    }
    if (!attachmentJson) {
      return NextResponse.json({ ok: false, error: "ATTACHMENT_REQUIRED" }, { status: 400 });
    }
    if (!(preview instanceof Blob) || preview.size === 0) {
      return NextResponse.json({ ok: false, error: "PREVIEW_BLOB_REQUIRED" }, { status: 400 });
    }

    const attachment = JSON.parse(attachmentJson) as ImageAttachment;
    const previewBuffer = Buffer.from(await preview.arrayBuffer());
    const thumbnailBuffer =
      thumbnail instanceof Blob && thumbnail.size > 0 ? Buffer.from(await thumbnail.arrayBuffer()) : null;

    const result = await backupAttachmentToDrive({
      recordId,
      attachment,
      preview: previewBuffer,
      thumbnail: thumbnailBuffer,
    });

    return NextResponse.json({
      ok: true,
      recordId,
      attachmentId: attachment.id,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ATTACHMENT_BACKUP_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
