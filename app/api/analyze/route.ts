import { NextResponse } from "next/server";

export const runtime = "nodejs";

type AnalyzeRequest = {
  text?: string;
  input_at?: string;
  model?: string;
};

function getJstStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function normalizeJson(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim().replace(/^#+/, ""))
        .filter(Boolean)
    )
  ).slice(0, 12);
}

function toBoolean(value: unknown) {
  if (value === true || value === false) return value;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function buildPrompt(originalInputTime: string, text: string) {
  return [
    "You are a strict CGMP memo parser for a Japanese PWA.",
    "Return JSON only.",
    "Use the provided Original input time as the base for relative date/time interpretation.",
    "Do not invent facts.",
    "Schema:",
    "{",
    '  "action": "note|reminder|calendar|unclear",',
    '  "para": "project|area|resource|archive|",',
    '  "domain": "work|family|self|health|finance|learning|creation|life_admin|other|",',
    '  "title": "string",',
    '  "body": "string",',
    '  "date": "YYYY-MM-DD or empty string",',
    '  "time": "HH:mm or empty string",',
    '  "duration_minutes": 60,',
    '  "all_day": false,',
    '  "location": "string",',
    '  "confirmation": "string",',
    '  "note_tags": "#tag #tag",',
    '  "note_index_line": "YYYY-MM-DD | TYPE | #tag | summary",',
    '  "user_intent_summary": "string",',
    '  "summary": "string",',
    '  "tags": ["tag"]',
    "}",
    "Rules:",
    "- action must be one of note, reminder, calendar, unclear.",
    "- title should be short and specific.",
    "- body should be a concise memo body in Japanese.",
    "- If action is reminder and date exists without time, set time to 17:00 and all_day to false.",
    "- If action is calendar and date exists without time, set time to 08:00 and all_day to true.",
    "- If date/time is unknown, leave them empty.",
    "- Tags should be concrete search keywords.",
    "- note_tags should be space-separated hashtags.",
    "- note_index_line should use TYPE as one of IDEA, WORK, LEARN, LOG.",
    "- confirmation and user_intent_summary should be short Japanese one-liners.",
    `Original input time: ${originalInputTime}`,
    "",
    "User input:",
    text,
  ].join("\n");
}

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
    const body = (await request.json()) as AnalyzeRequest;
    const text = String(body.text || "").trim();
    if (!text) {
      return NextResponse.json({ ok: false, error: "TEXT_REQUIRED" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY_NOT_CONFIGURED" }, { status: 500 });
    }

    const model = String(body.model || process.env.OPENAI_MODEL || "gpt-4.1-nano").trim();
    const originalInputTime = String(body.input_at || getJstStamp()).trim();
    const prompt = buildPrompt(originalInputTime, text);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You output only valid JSON that matches the requested schema.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { ok: false, error: `OPENAI_ERROR_${response.status}`, detail: errorText.slice(0, 1000) },
        { status: 502 }
      );
    }

    const payload = await response.json();
    const content = pickContent(payload);
    const parsed = normalizeJson(JSON.parse(content || "{}"));

    const result = {
      action: String(parsed.action || "unclear"),
      para: String(parsed.para || ""),
      domain: String(parsed.domain || ""),
      title: String(parsed.title || ""),
      body: String(parsed.body || text),
      date: String(parsed.date || ""),
      time: String(parsed.time || ""),
      duration_minutes: Number.isFinite(Number(parsed.duration_minutes)) ? Number(parsed.duration_minutes) : 60,
      all_day: toBoolean(parsed.all_day),
      location: String(parsed.location || ""),
      confirmation: String(parsed.confirmation || ""),
      note_tags: String(parsed.note_tags || ""),
      note_index_line: String(parsed.note_index_line || ""),
      user_intent_summary: String(parsed.user_intent_summary || ""),
      summary: String(parsed.summary || parsed.user_intent_summary || ""),
      tags: normalizeTags(parsed.tags),
    };

    return NextResponse.json({
      ok: true,
      model,
      generated_at: new Date().toISOString(),
      result,
      raw_response_text: content,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ANALYZE_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
