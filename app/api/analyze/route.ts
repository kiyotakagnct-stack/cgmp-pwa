import { NextResponse } from "next/server";

export const runtime = "nodejs";

type AnalyzeRequest = {
  text?: string;
  input_at?: string;
  model?: string;
};

type JsonObject = Record<string, unknown>;

type SplitAnalysis = {
  actionResult: JsonObject;
  datetimeResult: JsonObject;
  contentResult: JsonObject;
  tagsIndexResult: JsonObject;
  confirmationSummaryResult: JsonObject;
  classificationAttributesResult: JsonObject;
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

function normalizeJson(input: unknown): JsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as JsonObject;
}

function normalizeTags(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\s,，、\n]+/)
        .filter(Boolean);

  return Array.from(
    new Set(
      source
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

function normalizeAction(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "note" || normalized === "reminder" || normalized === "calendar" || normalized === "unclear") {
    return normalized;
  }
  return "unclear";
}

function normalizePara(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "project" || normalized === "area" || normalized === "resource" || normalized === "archive") {
    return normalized;
  }
  return "";
}

function normalizeDomain(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "work" ||
    normalized === "family" ||
    normalized === "self" ||
    normalized === "health" ||
    normalized === "finance" ||
    normalized === "learning" ||
    normalized === "creation" ||
    normalized === "life_admin" ||
    normalized === "other"
  ) {
    return normalized;
  }
  return "";
}

function normalizeDate(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeTime(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : "";
}

function normalizeDuration(value: unknown) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60;
}

function hasForcedFamilyKeyword(text: string) {
  return /久美子|凜|瑛登|瑛/.test(text);
}

function hasCreationKeyword(text: string) {
  return /CGMP|PWA|Scriptable|Viewer|アプリ開発|Google Drive同期|Drive同期/i.test(text);
}

function buildUserContent(originalInputTime: string, text: string) {
  return ["Original input time:", originalInputTime, "", "User input:", text].join("\n");
}

function buildActionPrompt() {
  return [
    "You classify Japanese memo input into one action for a Japanese PWA second-brain app.",
    "Return JSON only.",
    'Return exactly: {"action":""}',
    "Allowed action: note, reminder, calendar, unclear.",
    "Do not return any other action.",
    "Classify by intent and context, not by keyword-only matching.",
    "",
    "Core decision model:",
    "- note: 記録、考え、結果、議事録、観察、すでに起きたこと、保存したい情報。",
    "- reminder: ユーザーが未来に実行すべき作業、確認、送付、連絡、購入、準備。",
    "- calendar: 時間枠を確保する予定、会議、予約、訪問、参加イベント。",
    "- unclear: 意図が本当に判断できない場合のみ。",
    "",
    "Explicit intent words:",
    "- If the user explicitly says リマインド, reminder, TODO, ToDo, todo, タスク, やること, classify as reminder unless the text is clearly only explaining that concept.",
    "- If the user explicitly says 予定, カレンダー, スケジュール, schedule, calendar, アポ, classify as calendar unless the text is clearly a task to check/change/create that schedule.",
    "",
    "Disambiguation rules:",
    "- A date or time alone does not make it calendar.",
    "- A meeting-related word alone does not make it calendar.",
    "- If the input is meeting notes, minutes, results, observations, or a completed action, classify as note.",
    "- If the input primarily expresses something the user intends to do later, classify as reminder.",
    "- If the input primarily expresses an event the user will attend or put on a calendar, classify as calendar.",
    "- Japanese business shorthand such as DRS確認, 資料送付, AOI見直し, 部長報告 usually means a pending user task; classify as reminder unless it is clearly a record/result/minutes.",
    "- Prefer reminder over note when the main intent is an unfinished or pending action.",
    "- Prefer reminder over calendar when the text is about checking, changing, creating, or coordinating a schedule rather than attending the event itself.",
    "- Prefer note when meeting/memo/result cues are stronger than event-scheduling cues.",
    "",
    "Examples:",
    '明日DRS確認 => {"action":"reminder"}',
    'PTA会議議事録をメールで送付 => {"action":"reminder"}',
    '台湾チームとの打ち合わせメモ。Eject abort distanceを確認した => {"action":"note"}',
    '今日の会議メモ。ガラスが汚くて流れていない可能性あり => {"action":"note"}',
    '明日14時に台湾チームと打ち合わせ => {"action":"calendar"}',
    '明日の午前中、DRS確認会を入れる => {"action":"calendar"}',
    '5/28 10:00 歯医者 => {"action":"calendar"}',
    '歯医者に予約の電話をする => {"action":"reminder"}',
    'Viewer削除機能、confirmがScriptableで不安定だった => {"action":"note"}',
    'Viewer削除機能の動作確認 => {"action":"reminder"}',
  ].join("\n");
}

function buildDatetimePrompt() {
  return [
    "You extract datetime, deadline-like ranges, all_day, duration, and location from Japanese memo input.",
    "Return JSON only.",
    'Return exactly: {"date":"","time":"","duration_minutes":60,"all_day":false,"location":""}',
    "Use Original input time as the only base for relative dates.",
    "date format YYYY-MM-DD, time format HH:mm.",
    "",
    "Core rule:",
    "- Extract the user's intended target date/time, not the current input date/time.",
    "- If the input has no datetime clue at all, return empty date and empty time.",
    "- Do not fill current date/time just because the field is required.",
    "- Empty string is allowed for unknown date/time.",
    "- Month/day shorthand is a valid datetime clue. Never ignore expressions like 6/2, 06/02, 6月2日.",
    "",
    "Deadline/range expressions:",
    "- 今日中 => Original input date, time=17:00, all_day=false.",
    "- 今週中 / 今週まで / 今週以内 => this week's Sunday based on Original input time, time=17:00, all_day=false.",
    "- 来週中 / 来週まで / 来週以内 => next week's Sunday based on Original input time, time=17:00, all_day=false.",
    "- 今月中 / 今月まで / 今月以内 => last day of current month, time=17:00, all_day=false.",
    "- 来月中 / 来月まで / 来月以内 => last day of next month, time=17:00, all_day=false.",
    "- 年内 / 今年中 => December 31 of current year, time=17:00, all_day=false.",
    "- 月末 => last day of relevant month. If no month is specified, use current month. time=17:00, all_day=false.",
    "- 週末 => Sunday of relevant week. If no week is specified, use current week. time=17:00, all_day=false.",
    "- Treat 中/まで/以内 as deadline-like, not vague.",
    "",
    "Relative date examples:",
    "- 今日 => Original input date.",
    "- 明日 => Original input date + 1 day.",
    "- 明後日 => Original input date + 2 days.",
    "- 6/2, 06/02, 6月2日 => June 2 in the most natural year based on Original input time. Return a full YYYY-MM-DD date.",
    "- If month/day shorthand is near future or same year, use the Original input year. If it already passed by more than about 6 months, use next year.",
    "- 2026/6/2, 2026-06-02 => 2026-06-02.",
    "- 来週月曜 / 来週の月曜日 => Monday of next week.",
    "- 今度の金曜 => the next upcoming Friday. If today is Friday, use today only when wording clearly means today, otherwise use next Friday.",
    "",
    "Time rules:",
    "- If explicit time exists, extract it and set all_day=false.",
    "- 朝 / 朝イチ / 朝一 => 09:00, all_day=false.",
    "- 午前 => 09:00, all_day=false.",
    "- 午前中 => 10:00, all_day=false.",
    "- 昼 => 12:00, all_day=false.",
    "- 午後 => 14:00, all_day=false.",
    "- 夕方 => 17:00, all_day=false.",
    "- 夜 => 19:00, all_day=false.",
    "- If date exists but no exact time or time-of-day expression exists, return time empty. The final merge step will apply action-specific defaults.",
    '- If both date and time are unknown, return date="", time="", all_day=false.',
    "",
    "Duration/location:",
    "- duration_minutes defaults to 60 unless the input clearly says otherwise.",
    "- location should be empty unless explicitly stated.",
  ].join("\n");
}

function buildContentPrompt() {
  return [
    "You create title and body from Japanese memo input.",
    "Return JSON only.",
    'Return exactly: {"title":"","body":""}',
    "",
    "Rules:",
    "- title: short natural Japanese, but specific enough to identify the memo later.",
    "- For task-like input, include the concrete target and main action when available.",
    "- Avoid generic titles like タスク確認, 作業メモ, 確認事項, 対応予定 when concrete details exist.",
    "- Do not include scheduling-only words such as 今日/明日/6/2/6月2日/17時 in title when the remaining concrete content identifies the item.",
    "- Keep date/time information in body when useful; title should usually be the task/event subject only.",
    "- For input like '6/2 台風対策', title must be '台風対策', not '6/2 台風対策'.",
    "- For input like '明日 DRS確認', title must be 'DRS確認', not '明日DRS確認'.",
    "- body: concise readable Japanese memo text.",
    "- Preserve key details and terms.",
    "- Do not invent facts.",
    "- Stay faithful to the user input.",
    "- Do not add background, reasons, assumptions, advice, preparation steps, or confirmation steps not present in the input.",
    "- Do not turn the user's input into a polite explanatory sentence.",
    "- Avoid unnatural endings such as 「〜しています」「〜です」「〜となります」 unless they were clearly present in the original input.",
    "- Do not add confirmation-like wording such as 「確認です」「準備です」「予定です」.",
    "- Do not invent intermediate steps such as 「準備」「確認」 unless explicitly present in the input.",
    "- For task-like input, write body as a concise action phrase or memo sentence.",
    "- For note-like input, write body as a faithful cleaned memo.",
    "- If the input is a fragment, keep it as a natural Japanese memo fragment instead of forcing a full polite sentence.",
    "- Prefer concise plain-form Japanese.",
    "- Use punctuation to improve readability, but do not over-rewrite.",
    "",
    "Examples:",
    '入力: 土曜日 久美子の職場近くでイベントあり お出かけするか検討\n出力: {"title":"土曜日の久美子の職場近くイベント検討","body":"土曜日、久美子の職場近くでイベントあり。お出かけするか検討。"}',
    '入力: タスク 棚卸し資料西尾さんへ送付\n出力: {"title":"棚卸し資料の西尾さんへの送付","body":"棚卸し資料を西尾さんへ送付。"}',
    '入力: 明日DRS確認\n出力: {"title":"DRS確認","body":"明日、DRS確認。"}',
    '入力: 6/2 台風対策\n出力: {"title":"台風対策","body":"6/2、台風対策。"}',
    '入力: Viewer削除機能 confirmがScriptableで不安定だった\n出力: {"title":"Viewer削除機能のconfirm不安定問題","body":"Viewer削除機能で、confirmがScriptableで不安定だった。"}',
  ].join("\n");
}

function buildTagsIndexPrompt() {
  return [
    "You create search-focused tags and index line from Japanese memo input.",
    "Return JSON only.",
    'Return exactly: {"note_tags":"","note_index_line":"","tags":[]}',
    "",
    "Rules:",
    "- note_tags must be 1-6 hashtags separated by spaces.",
    "- tags must be the same keywords as note_tags but without #.",
    "- Tags are concrete search keywords, not categories.",
    "- Do not include PARA or domain-like tags because para/domain are separate fields.",
    "- Avoid generic tags such as #仕事, #プライベート, #タスク, #メモ, #確認事項, #予定, #その他.",
    "- Prefer proper nouns, acronyms, project names, product names, model names, teams, processes, issues, and target objects.",
    "- If acronyms like NEGT, AOI, AMAT, DRS appear, keep them as uppercase tags.",
    "- Exception: ignore NEG alone because it is the user's company name.",
    "- If a person's name appears, include at most one person-name tag.",
    "- Use Japanese tags for Japanese concepts, but preserve acronyms in uppercase.",
    "- note_index_line format: YYYY-MM-DD | TYPE | #tag... | summary.",
    "- TYPE must be one of IDEA, WORK, LEARN, LOG.",
    "- IDEA: idea, thought, proposal, hypothesis.",
    "- WORK: work-related task, note, or schedule.",
    "- LEARN: learning, research, study, knowledge.",
    "- LOG: daily record, observation, result, past event.",
    "- If date is unknown, use YYYY-MM-DD as placeholder in examples but do not invent a real date.",
  ].join("\n");
}

function buildConfirmationSummaryPrompt() {
  return [
    "You create confirmation, user intent summary, and card summary from Japanese memo input.",
    "Return JSON only.",
    'Return exactly: {"confirmation":"","user_intent_summary":"","summary":""}',
    "",
    "Rules:",
    "- All fields should be short natural Japanese one-liners.",
    "- summary must be within 40 Japanese characters.",
    "- confirmation must be within 50 Japanese characters.",
    "- user_intent_summary must be within 60 Japanese characters.",
    "- summary should be a short memo-card label, not a polite explanatory sentence.",
    "- summary should not end with 「しています」「です」「ます」 unless absolutely necessary.",
    "- For task-like input, summary should be 「対象 + 行動」.",
    "- For consideration/planning input, summary should use noun-like short phrasing such as 「検討」, not 「検討しています」.",
    "- confirmation may be polite because it is shown to the user as feedback.",
    "- user_intent_summary should briefly describe the interpreted intent, but must not invent actions.",
    "- Do not add 「確認です」「準備です」「検討しています」.",
    "- Do not add 「準備」 or 「確認」 unless those words or meanings are clearly in the input.",
    "- Do not include verbose explanations.",
    "- Do not include JSON reasoning.",
    "- Keep searchable keywords.",
    "",
    "Examples:",
    '入力: 土曜日 久美子の職場近くでイベントあり お出かけするか検討\n出力: {"confirmation":"メモとして保存します。","user_intent_summary":"久美子の職場近くのイベントに行くか検討する意図。","summary":"久美子の職場近くイベントを検討"}',
    '入力: タスク 棚卸し資料西尾さんへ送付\n出力: {"confirmation":"リマインダー候補として整理しました。","user_intent_summary":"棚卸し資料を西尾さんへ送付する意図。","summary":"棚卸し資料を西尾さんへ送付"}',
    '入力: 明日DRS確認\n出力: {"confirmation":"リマインダー候補として整理しました。","user_intent_summary":"明日DRSを確認する意図。","summary":"DRS確認"}',
    '入力: Viewer削除機能 confirmがScriptableで不安定だった\n出力: {"confirmation":"メモとして保存します。","user_intent_summary":"Viewer削除機能のconfirm不安定問題の記録。","summary":"Viewer削除機能のconfirm不安定問題"}',
  ].join("\n");
}

function buildClassificationAttributesPrompt() {
  return [
    "You classify memo input into PARA and Domain attributes.",
    "Return JSON only.",
    'Return exactly: {"para":"","domain":""}',
    "",
    "Allowed para:",
    "project, area, resource, archive",
    "",
    "Allowed domain:",
    "work, family, self, health, finance, learning, creation, life_admin, other",
    "",
    "PARA guide:",
    "- project: 期限や成果物がある進行中の案件。",
    "- area: 継続的に管理する生活・仕事上の責任領域。",
    "- resource: 後で参照する知識、アイデア、資料、学び。",
    "- archive: 完了済み、過去ログ、保存のみの記録。",
    "- If unsure, use area.",
    "",
    "Domain guide:",
    "- work: 業務、会社、顧客、製造、開発、会議、出張。",
    "- family: 家族、家庭、または 久美子、凜、瑛、瑛登 に関する内容。",
    "- self: 個人的な考え、感情、生活改善、内省。",
    "- health: 睡眠、運動、禁煙、断酒、体調、病院。",
    "- finance: お金、投資、支払い、家計、税金。",
    "- learning: 勉強、調査、読書、語学、知識習得。",
    "- creation: YouTube、動画、アプリ開発、文章、創作、PWA、Scriptable、CGMP、Viewer。",
    "- life_admin: 役所、手続き、予約、買い物、家事、生活管理。",
    "- other: どれにも当てはまらないもの。",
    "",
    "Important family rule:",
    "- If the input contains 久美子, 凜, 瑛, or 瑛登, domain must be family.",
    "- Do not force family for generic words like 家族 or 子ども unless the input is clearly about the user's family/home life.",
    "- 凛 is not included in the forced-family keyword list unless it appears in the current rule list. Use only 久美子, 凜, 瑛, 瑛登 as forced keywords.",
    "",
    "Rules:",
    "- choose one para and one domain only.",
    "- if unsure: para=area, domain=other.",
    "",
    "Examples:",
    '土曜日 久美子の職場近くでイベントあり お出かけするか検討 => {"para":"area","domain":"family"}',
    'タスク 棚卸し資料西尾さんへ送付 => {"para":"area","domain":"work"}',
    'Viewer削除機能 confirmがScriptableで不安定だった => {"para":"resource","domain":"creation"}',
    'PWAのGoogle Drive同期仕様を見直す => {"para":"project","domain":"creation"}',
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

async function callOpenAIJson({
  apiKey,
  model,
  prompt,
  userContent,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  userContent: string;
}) {
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
          content: `${prompt}\n\n${userContent}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OPENAI_ERROR_${response.status}: ${errorText.slice(0, 1000)}`);
  }

  const payload = await response.json();
  const content = pickContent(payload);
  return normalizeJson(JSON.parse(content || "{}"));
}

async function runSplitAnalysis({
  apiKey,
  model,
  userContent,
}: {
  apiKey: string;
  model: string;
  userContent: string;
}): Promise<SplitAnalysis> {
  const [
    actionResult,
    datetimeResult,
    contentResult,
    tagsIndexResult,
    confirmationSummaryResult,
    classificationAttributesResult,
  ] = await Promise.all([
    callOpenAIJson({ apiKey, model, userContent, prompt: buildActionPrompt() }),
    callOpenAIJson({ apiKey, model, userContent, prompt: buildDatetimePrompt() }),
    callOpenAIJson({ apiKey, model, userContent, prompt: buildContentPrompt() }),
    callOpenAIJson({ apiKey, model, userContent, prompt: buildTagsIndexPrompt() }),
    callOpenAIJson({ apiKey, model, userContent, prompt: buildConfirmationSummaryPrompt() }),
    callOpenAIJson({ apiKey, model, userContent, prompt: buildClassificationAttributesPrompt() }),
  ]);

  return {
    actionResult,
    datetimeResult,
    contentResult,
    tagsIndexResult,
    confirmationSummaryResult,
    classificationAttributesResult,
  };
}

function mergeSplitResults(split: SplitAnalysis) {
  return {
    action: split.actionResult.action,
    date: split.datetimeResult.date,
    time: split.datetimeResult.time,
    duration_minutes: split.datetimeResult.duration_minutes,
    all_day: split.datetimeResult.all_day,
    location: split.datetimeResult.location,
    title: split.contentResult.title,
    body: split.contentResult.body,
    note_tags: split.tagsIndexResult.note_tags,
    note_index_line: split.tagsIndexResult.note_index_line,
    tags: split.tagsIndexResult.tags,
    confirmation: split.confirmationSummaryResult.confirmation,
    user_intent_summary: split.confirmationSummaryResult.user_intent_summary,
    summary: split.confirmationSummaryResult.summary,
    para: split.classificationAttributesResult.para,
    domain: split.classificationAttributesResult.domain,
  };
}

function normalizeFinalResult(merged: JsonObject, originalText: string) {
  const action = normalizeAction(merged.action);
  const date = normalizeDate(merged.date);
  let time = normalizeTime(merged.time);
  let allDay = toBoolean(merged.all_day);
  let domain = normalizeDomain(merged.domain);
  let para = normalizePara(merged.para);
  const title = String(merged.title || "").trim();
  const body = String(merged.body || "").trim() || originalText;
  const confirmation = String(merged.confirmation || "").trim();
  const userIntentSummary = String(merged.user_intent_summary || "").trim();
  const summary = String(merged.summary || userIntentSummary || confirmation || title).trim();
  const noteTags = String(merged.note_tags || "").trim();
  const tags = normalizeTags(Array.isArray(merged.tags) && merged.tags.length > 0 ? merged.tags : noteTags);

  if (date && !time && action === "reminder") {
    time = "17:00";
    allDay = false;
  }

  if (date && !time && action === "calendar") {
    time = "08:00";
    allDay = true;
  }

  if (!date && !normalizeTime(merged.time)) {
    time = "";
    allDay = false;
  }

  if (hasForcedFamilyKeyword(originalText)) {
    domain = "family";
  } else if (hasCreationKeyword(originalText)) {
    domain = "creation";
  }

  if (!para && hasCreationKeyword(originalText)) {
    para = /仕様|実装|見直す|開発|同期/.test(originalText) ? "project" : "resource";
  }

  return {
    action,
    para,
    domain,
    title,
    body,
    date,
    time,
    duration_minutes: normalizeDuration(merged.duration_minutes),
    all_day: allDay,
    location: String(merged.location || "").trim(),
    confirmation,
    note_tags: noteTags || tags.map((tag) => `#${tag}`).join(" "),
    note_index_line: String(merged.note_index_line || "").trim(),
    user_intent_summary: userIntentSummary,
    summary,
    tags,
  };
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
    const userContent = buildUserContent(originalInputTime, text);

    let split: SplitAnalysis;
    try {
      split = await runSplitAnalysis({ apiKey, model, userContent });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ANALYZE_SPLIT_FAILED",
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 502 }
      );
    }

    const merged = mergeSplitResults(split);
    const result = normalizeFinalResult(merged, text);
    const rawResponseText = JSON.stringify({ split, merged, result });

    return NextResponse.json({
      ok: true,
      model,
      generated_at: new Date().toISOString(),
      result,
      raw_response_text: rawResponseText,
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
