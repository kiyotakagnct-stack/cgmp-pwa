import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "ATTACHMENT_BACKUP_NOT_IMPLEMENTED",
    },
    { status: 501 }
  );
}
