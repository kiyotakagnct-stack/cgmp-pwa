import { NextResponse } from "next/server";

import { saveDeletedRecordToVercelBlob } from "@/lib/cgmp/vercel-blob-store-server";
import type { CGMPDeletedRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { tombstone?: CGMPDeletedRecord };
    if (!body.tombstone?.record_id) {
      return NextResponse.json({ ok: false, error: "TOMBSTONE_REQUIRED" }, { status: 400 });
    }

    const result = await saveDeletedRecordToVercelBlob(body.tombstone);
    return NextResponse.json({
      ok: true,
      recordId: body.tombstone.record_id,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "BLOB_DELETE_TOMBSTONE_SAVE_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
