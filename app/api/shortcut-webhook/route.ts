import { NextResponse } from "next/server";

import { createRecordFromShortcutWebhook, type ShortcutWebhookRequest } from "@/lib/cgmp/shortcut-webhook";

export const runtime = "nodejs";

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status });
}

function isAuthorized(request: Request) {
  const expected = process.env.SHORTCUT_WEBHOOK_TOKEN?.trim();
  if (!expected) return true;
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return jsonResponse(
      {
        ok: false,
        message: "認証に失敗しました",
        errorCode: "UNAUTHORIZED",
        confirmationText: "認証に失敗しました。Webhook設定を確認してください。",
      },
      401
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as ShortcutWebhookRequest;
    const text = String(body.text || "").trim();
    if (!text) {
      return jsonResponse(
        {
          ok: false,
          message: "textが空です",
          errorCode: "TEXT_REQUIRED",
          confirmationText: "入力テキストが空です。ショートカット設定を確認してください。",
        },
        400
      );
    }

    const result = await createRecordFromShortcutWebhook({ request, body: { ...body, text } });
    return jsonResponse(result, result.ok ? 200 : 502);
  } catch (error) {
    console.error("[cgmp:shortcut-webhook] failed", error);
    const message = error instanceof Error ? error.message : "SHORTCUT_WEBHOOK_FAILED";
    return jsonResponse(
      {
        ok: false,
        message: "登録に失敗しました",
        errorCode: message.includes("ANALYZE") ? "AI_ANALYZE_FAILED" : "SHORTCUT_WEBHOOK_FAILED",
        error: message,
        confirmationText: "登録に失敗しました。CGMPアプリで確認してください。",
      },
      500
    );
  }
}
