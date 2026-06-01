import { NextResponse } from "next/server";

import { listVercelBlobRecords } from "@/lib/cgmp/vercel-blob-store-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await listVercelBlobRecords();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "BLOB_RESTORE_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
