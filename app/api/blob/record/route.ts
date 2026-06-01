import { NextResponse } from "next/server";

import { saveRecordToVercelBlob } from "@/lib/cgmp/vercel-blob-store-server";
import type { CGMPRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { record?: CGMPRecord };
    if (!body.record?.id) {
      return NextResponse.json({ ok: false, error: "RECORD_REQUIRED" }, { status: 400 });
    }

    const result = await saveRecordToVercelBlob(body.record);
    return NextResponse.json({
      ok: true,
      recordId: body.record.id,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "BLOB_RECORD_SAVE_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
