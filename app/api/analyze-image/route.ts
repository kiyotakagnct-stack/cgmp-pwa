import { NextResponse } from "next/server";

import { loadPromptConfigFromDrive } from "@/lib/cgmp/drive-backup-server";
import { buildAnalyzePrompt, createDefaultPromptConfig } from "@/lib/cgmp/prompt-config";
import { sanitizeVisionResult } from "@/lib/image/sanitizeVisionResult";

export const runtime = "nodejs";

function pickContent(payload: any) {
  return (
    payload?.choices?.[0]?.message?.content ??
    payload?.output_text ??
    payload?.output?.[0]?.content?.[0]?.text ??
    ""
  );
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    if (!(image instanceof Blob) || image.size === 0) {
      return NextResponse.json({ ok: false, error: "IMAGE_REQUIRED" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY_NOT_CONFIGURED" }, { status: 500 });
    }

    const arrayBuffer = await image.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const model = "gpt-4.1-nano";
    let systemPrompt = buildAnalyzePrompt("image_analysis", createDefaultPromptConfig());
    try {
      systemPrompt = buildAnalyzePrompt("image_analysis", await loadPromptConfigFromDrive());
    } catch (error) {
      console.debug("[cgmp:image] prompt config fallback to default", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this image and return JSON only." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : JSON.stringify(payload).slice(0, 1000);
      return NextResponse.json(
        { ok: false, error: `OPENAI_VISION_ERROR_${response.status}`, detail: message },
        { status: 502 }
      );
    }

    const content = pickContent(payload);
    const parsed = JSON.parse(content || "{}");
    const result = sanitizeVisionResult(parsed);

    return NextResponse.json({
      ok: true,
      model,
      generated_at: new Date().toISOString(),
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ANALYZE_IMAGE_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
