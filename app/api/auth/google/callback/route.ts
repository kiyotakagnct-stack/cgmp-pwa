import { NextResponse } from "next/server";

import { exchangeCodeForTokens } from "@/lib/cgmp/drive-backup-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      return NextResponse.json({ ok: false, error: oauthError }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ ok: false, error: "CODE_REQUIRED" }, { status: 400 });
    }

    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token || "";

    return new NextResponse(
      `<!doctype html>
        <html lang="ja">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>CGMP Google Auth</title>
            <style>
              body { margin: 0; background: #020617; color: #e5e7eb; font-family: ui-sans-serif, system-ui, sans-serif; }
              main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
              section { width: min(760px, 100%); border: 1px solid rgba(255,255,255,.12); border-radius: 24px; padding: 24px; background: rgba(15,23,42,.88); }
              code, textarea { width: 100%; box-sizing: border-box; border-radius: 14px; background: #020617; color: #cffafe; border: 1px solid rgba(34,211,238,.28); padding: 12px; }
              textarea { min-height: 110px; }
              p { line-height: 1.7; color: #cbd5e1; }
            </style>
          </head>
          <body>
            <main>
              <section>
                <p>CGMP の Google 連携認可が完了しました。</p>
                ${
                  refreshToken
                    ? `<p>次に Vercel の Environment Variables に <code>GOOGLE_REFRESH_TOKEN</code> として以下を登録してください。</p><textarea readonly>${refreshToken}</textarea>`
                    : "<p>refresh token が返りませんでした。すでに認可済みの場合は、Googleアカウント側でアプリ連携を解除してから再度実行してください。</p>"
                }
              </section>
            </main>
          </body>
        </html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "GOOGLE_AUTH_CALLBACK_FAILED",
      },
      { status: 500 }
    );
  }
}
