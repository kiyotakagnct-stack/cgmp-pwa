import { NextResponse } from "next/server";

export const runtime = "nodejs";

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY is not configured" }, { status: 500 });
    }
    const body = (await request.json().catch(() => ({}))) as { text?: string; model?: string };
    const text = String(body.text || "").trim();
    const model = String(body.model || "text-embedding-3-small").trim() || "text-embedding-3-small";
    if (!text) {
      return NextResponse.json({ ok: false, error: "TEXT_REQUIRED" }, { status: 400 });
    }

    const startedAt = performance.now();
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as EmbeddingResponse;
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: payload.error?.message || "OPENAI_EMBEDDING_FAILED" },
        { status: response.status }
      );
    }
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector)) {
      return NextResponse.json({ ok: false, error: "EMBEDDING_VECTOR_MISSING" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      model,
      dimensions: vector.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      vector,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "EMBEDDING_FAILED",
      },
      { status: 500 }
    );
  }
}
