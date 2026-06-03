import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const backupMode = process.env.GOOGLE_DRIVE_BACKUP_MODE || (process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID ? "drive" : "appdata");
  return NextResponse.json({
    ok: true,
    driveConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REDIRECT_URI &&
        process.env.GOOGLE_REFRESH_TOKEN
    ),
    backupMode,
    backupFolderName: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_NAME || "CGMP_Backup",
    backupFolderId: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || "",
    backupSpace: backupMode === "drive" ? "drive" : "appDataFolder",
  });
}
