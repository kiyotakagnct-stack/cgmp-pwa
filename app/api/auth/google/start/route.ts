import { NextResponse } from "next/server";

import { getGoogleAuthUrl } from "@/lib/cgmp/drive-backup-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.redirect(getGoogleAuthUrl());
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "GOOGLE_AUTH_START_FAILED",
      },
      { status: 500 }
    );
  }
}
