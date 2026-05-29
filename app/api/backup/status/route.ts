import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    driveConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REDIRECT_URI &&
        process.env.GOOGLE_REFRESH_TOKEN
    ),
    backupSpace: process.env.GOOGLE_DRIVE_BACKUP_SPACE || "appDataFolder",
  });
}
