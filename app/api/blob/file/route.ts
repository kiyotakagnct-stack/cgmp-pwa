import { NextResponse } from "next/server";

import { getVercelBlobFile } from "@/lib/cgmp/vercel-blob-store-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pathname = String(url.searchParams.get("pathname") || "").trim();
    if (!pathname) {
      return NextResponse.json({ ok: false, error: "PATHNAME_REQUIRED" }, { status: 400 });
    }

    const result = await getVercelBlobFile(pathname);
    const headers = new Headers();
    headers.set("Content-Type", result.blob.contentType || "application/octet-stream");
    headers.set("Cache-Control", "private, max-age=60");
    if (result.blob.size != null) headers.set("Content-Length", String(result.blob.size));
    if (result.blob.etag) headers.set("ETag", result.blob.etag);

    return new Response(result.stream, { status: 200, headers });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "BLOB_FILE_DOWNLOAD_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
