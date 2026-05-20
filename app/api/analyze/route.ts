import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type AnalyzeResponse = {
  action: { a: "calendar" | "reminder" | "note" | "unclear" } | null;
  date: { dt: string } | null;
  tag: { t: string[] } | null;
  title: { ttl: string } | null;
  errors: Partial<Record<"action" | "date" | "tag" | "title", string>>;
};

type JsonTaskResult<T> = {
  value: T | null;
  error?: string;
};

type ActionValue = "calendar" | "reminder" | "note" | "unclear";

function getJstNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const currentDate = `${map.year}-${map.month}-${map.day}`;
  const currentTime = `${map.hour}:${map.minute}`;

  return {
    currentDate,
    currentTime,
    timezone: "Asia/Tokyo",
  };
}

function extractContent(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input && typeof input === "object" && "content" in input) {
    const content = (input as { content?: unknown }).content;
    if (typeof content === "string") {
      return content;
    }
  }

  return "";
}

function parseJsonTask<T>(
  taskName: string,
  rawContent: string,
  expectedKey: string,
  validator: (value: unknown) => value is T
): JsonTaskResult<T> {
  const trimmed = rawContent.trim();

  if (!trimmed) {
    return { value: null, error: `${taskName}: empty response` };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { value: null, error: `${taskName}: JSON parse failed` };
  }

  if (!parsed || typeof parsed !== "object" || !(expectedKey in parsed)) {
    return {
      value: null,
      error: `${taskName}: expected key ${expectedKey} missing`,
    };
  }

  const candidate = (parsed as Record<string, unknown>)[expectedKey];
  if (!validator(candidate)) {
    return {
      value: null,
      error: `${taskName}: invalid ${expectedKey} value`,
    };
  }

  return { value: parsed as T };
}

async function callJsonTask<T>({
  taskName,
  systemPrompt,
  userMessage,
  maxTokens,
  expectedKey,
  validator,
}: {
  taskName: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  expectedKey: string;
  validator: (value: unknown) => value is T;
}): Promise<JsonTaskResult<T>> {
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-nano",
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const content = extractContent(completion.choices[0]?.message?.content);
  return parseJsonTask<T>(taskName, content, expectedKey, validator);
}

function isActionValue(value: unknown): value is ActionValue {
  if (typeof value !== "string") {
    return false;
  }

  return ["calendar", "reminder", "note", "unclear"].includes(value);
}

function isDateValue(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTitleValue(value: unknown): value is string {
  return typeof value === "string";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message = String(body.message ?? "").trim();

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const { currentDate, currentTime, timezone } = getJstNow();
  const sharedUserMessage = message;

  const actionTask = callJsonTask<{ a: ActionValue }>({
    taskName: "action",
    systemPrompt:
      "You classify the message into one Japanese intent. Return JSON only with key a. Choose calendar, reminder, note, or unclear.",
    userMessage: sharedUserMessage,
    maxTokens: 20,
    expectedKey: "a",
    validator: isActionValue,
  });

  const dateTask = callJsonTask<{ dt: string | null }>({
    taskName: "date",
    systemPrompt:
      `You extract a date/time from Japanese text. Current date is ${currentDate}, current time is ${currentTime}, timezone is ${timezone}. Return JSON only with key dt. If date is unclear, return {"dt":null}. Use "YYYY-MM-DD HH:mm" when time is available, "YYYY-MM-DD" when only date is available.`,
    userMessage: sharedUserMessage,
    maxTokens: 40,
    expectedKey: "dt",
    validator: isDateValue,
  });

  const tagTask = callJsonTask<{ t: string[] }>({
    taskName: "tag",
    systemPrompt:
      "You extract 2 to 5 short Japanese tags. Return JSON only with key t as an array of strings. No #. Prefer specific names, project names, and action types. Avoid generic tags. Do not use date/time/generic tags like 今日, 明日, 午後, 14時, スケジュール.",
    userMessage: sharedUserMessage,
    maxTokens: 80,
    expectedKey: "t",
    validator: isStringArray,
  });

  const titleTask = callJsonTask<{ ttl: string }>({
    taskName: "title",
    systemPrompt:
      "You summarize the message into a 10 to 30 character Japanese title. Return JSON only with key ttl.",
    userMessage: sharedUserMessage,
    maxTokens: 60,
    expectedKey: "ttl",
    validator: isTitleValue,
  });

  const [actionResult, dateResult, tagResult, titleResult] = await Promise.allSettled([
    actionTask,
    dateTask,
    tagTask,
    titleTask,
  ]);

  const response: AnalyzeResponse = {
    action: null,
    date: null,
    tag: null,
    title: null,
    errors: {},
  };

  if (actionResult.status === "fulfilled") {
    response.action = actionResult.value.value;
    if (actionResult.value.error) {
      response.errors.action = actionResult.value.error;
    }
  } else {
    response.errors.action = "request failed";
  }

  if (dateResult.status === "fulfilled") {
    const extractedDate = dateResult.value.value?.dt;
    response.date =
      typeof extractedDate === "string" && extractedDate.length > 0
        ? { dt: extractedDate }
        : null;
    if (dateResult.value.error) {
      response.errors.date = dateResult.value.error;
    }
  } else {
    response.errors.date = "request failed";
  }

  if (tagResult.status === "fulfilled") {
    response.tag = tagResult.value.value;
    if (tagResult.value.error) {
      response.errors.tag = tagResult.value.error;
    }
  } else {
    response.errors.tag = "request failed";
  }

  if (titleResult.status === "fulfilled") {
    response.title = titleResult.value.value;
    if (titleResult.value.error) {
      response.errors.title = titleResult.value.error;
    }
  } else {
    response.errors.title = "request failed";
  }

  return Response.json(response);
}
