export const CGMP_PROMPT_CONFIG_VERSION = 1;

export type CGMPPromptKey =
  | "action"
  | "datetime"
  | "content"
  | "tags_index"
  | "confirmation_summary"
  | "classification"
  | "image_analysis";

export type CGMPPromptOverride = {
  key: CGMPPromptKey;
  userPrompt: string;
  updated_at?: string;
};

export type CGMPPromptConfigFile = {
  schema_version: number;
  kind: "cgmp_prompt_config";
  updated_at: string;
  prompts: Partial<Record<CGMPPromptKey, CGMPPromptOverride>>;
};

export type CGMPPromptDefinition = {
  key: CGMPPromptKey;
  label: string;
  description: string;
  defaultUserPrompt: string;
  hiddenContract: string;
};

const PROMPT_DEFINITIONS: CGMPPromptDefinition[] = [
  {
    key: "action",
    label: "Action分類",
    description: "note / reminder / calendar / unclear の分類方針です。",
    defaultUserPrompt: [
      "Classify by intent and context, not by keyword-only matching.",
      "",
      "Core decision model:",
      "- note: 記録、考え、結果、議事録、観察、すでに起きたこと、保存したい情報。",
      "- reminder: ユーザーが未来に実行すべき作業、確認、送付、連絡、購入、準備。",
      "- calendar: 時間枠を確保する予定、会議、予約、訪問、参加イベント。",
      "- unclear: 意図が本当に判断できない場合のみ。",
      "",
      "Explicit intent words:",
      "- Treat explicit action-category words as high-priority user intent signals.",
      "- If the user explicitly says タスク, やること, Todo, ToDo, todo, TODO, リマインダー, リマインド, reminder, classify as reminder unless the text is clearly only explaining/quoting that word.",
      "- If the user explicitly says 予定, スケジュール, カレンダー, schedule, calendar, アポ, classify as calendar unless the text is clearly only explaining/quoting that word.",
      "- When both reminder words and calendar words appear, classify by the stronger user intent. If impossible to tell, prefer the explicitly written category nearest to the main object/title.",
      "- Do not downgrade explicit タスク/やること/Todo/リマインダー to note merely because the text also contains a date/time.",
      "- Do not downgrade explicit 予定/スケジュール/カレンダー to note merely because the text is short.",
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
      "明日DRS確認 => reminder",
      "PTA会議議事録をメールで送付 => reminder",
      "台湾チームとの打ち合わせメモ。Eject abort distanceを確認した => note",
      "明日14時に台湾チームと打ち合わせ => calendar",
      "Viewer削除機能、confirmがScriptableで不安定だった => note",
    ].join("\n"),
    hiddenContract: [
      "You classify Japanese memo input into one action for a Japanese PWA second-brain app.",
      "Return JSON only.",
      'Return exactly: {"action":""}',
      "Allowed action: note, reminder, calendar, unclear.",
      "Do not return any other action.",
    ].join("\n"),
  },
  {
    key: "datetime",
    label: "日時抽出",
    description: "日付・時刻・終日・所要時間・場所の抽出方針です。",
    defaultUserPrompt: [
      "Use Original input time as the only base for relative dates.",
      "Original input time is already expressed in Asia/Tokyo local time. Do not reinterpret it as UTC.",
      "For relative words, use the date part of Original input time exactly as the user's today.",
      "",
      "Core rule:",
      "- Extract the user's intended target date/time, not the current input date/time.",
      "- If the input has no datetime clue at all, return empty date and empty time.",
      "- Do not fill current date/time just because the field is required.",
      "- Month/day shorthand is a valid datetime clue. Never ignore expressions like 6/2, 06/02, 6月2日.",
      "",
      "Deadline/range expressions:",
      "- 今日中 => Original input date, time=17:00, all_day=false.",
      "- 今週中 / 今週まで / 今週以内 => this week's Sunday based on Original input time, time=17:00, all_day=false.",
      "- 来週中 / 来週まで / 来週以内 => next week's Sunday based on Original input time, time=17:00, all_day=false.",
      "- 今月中 / 今月まで / 今月以内 => last day of current month, time=17:00, all_day=false.",
      "- 月末 => last day of relevant month. If no month is specified, use current month. time=17:00, all_day=false.",
      "- Treat 中/まで/以内 as deadline-like, not vague.",
      "",
      "Relative date examples:",
      "- 今日 => Original input date.",
      "- 明日 => Original input date + 1 day.",
      "- 明後日 => Original input date + 2 days.",
      "- 6/2, 06/02, 6月2日 => June 2 in the most natural year based on Original input time.",
      "- If month/day shorthand is near future or same year, use the Original input year. If it already passed by more than about 6 months, use next year.",
      "",
      "Time rules:",
      "- If explicit time exists, extract it and set all_day=false.",
      "- 朝 / 朝イチ / 朝一 => 09:00.",
      "- 午前中 => 10:00.",
      "- 昼 => 12:00.",
      "- 午後 => 14:00.",
      "- 夕方 => 17:00.",
      "- 夜 => 19:00.",
      "- If date exists but no exact time or time-of-day expression exists, return time empty.",
      "",
      "Duration/location:",
      "- duration_minutes defaults to 60 unless the input clearly says otherwise.",
      "- location should be empty unless explicitly stated.",
    ].join("\n"),
    hiddenContract: [
      "You extract datetime, deadline-like ranges, all_day, duration, and location from Japanese memo input.",
      "Return JSON only.",
      'Return exactly: {"date":"","time":"","duration_minutes":60,"all_day":false,"location":""}',
      "date format YYYY-MM-DD, time format HH:mm.",
      'If both date and time are unknown, return date="", time="", all_day=false.',
    ].join("\n"),
  },
  {
    key: "content",
    label: "Title / Body",
    description: "タイトルと本文の作り方です。",
    defaultUserPrompt: [
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
      "- Prefer concise plain-form Japanese.",
      "- Use punctuation to improve readability, but do not over-rewrite.",
      "",
      "Examples:",
      "入力: タスク 棚卸し資料西尾さんへ送付 / title: 棚卸し資料の西尾さんへの送付 / body: 棚卸し資料を西尾さんへ送付。",
      "入力: 明日DRS確認 / title: DRS確認 / body: 明日、DRS確認。",
      "入力: 6/2 台風対策 / title: 台風対策 / body: 6/2、台風対策。",
    ].join("\n"),
    hiddenContract: [
      "You create title and body from Japanese memo input.",
      "Return JSON only.",
      'Return exactly: {"title":"","body":""}',
      "Do not include any field other than title and body.",
    ].join("\n"),
  },
  {
    key: "tags_index",
    label: "Tags / Index",
    description: "検索タグとindex lineの作り方です。",
    defaultUserPrompt: [
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
      "- TYPE must be one of IDEA, WORK, LEARN, LOG.",
      "- IDEA: idea, thought, proposal, hypothesis.",
      "- WORK: work-related task, note, or schedule.",
      "- LEARN: learning, research, study, knowledge.",
      "- LOG: daily record, observation, result, past event.",
    ].join("\n"),
    hiddenContract: [
      "You create search-focused tags and index line from Japanese memo input.",
      "Return JSON only.",
      'Return exactly: {"note_tags":"","note_index_line":"","tags":[]}',
      "- note_index_line format: YYYY-MM-DD | TYPE | #tag... | summary.",
      "- If date is unknown, use YYYY-MM-DD as placeholder in examples but do not invent a real date.",
    ].join("\n"),
  },
  {
    key: "confirmation_summary",
    label: "Confirmation / Summary",
    description: "確認文、意図要約、カード要約の作り方です。",
    defaultUserPrompt: [
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
      "- Keep searchable keywords.",
      "",
      "Examples:",
      "入力: タスク 棚卸し資料西尾さんへ送付 / confirmation: リマインダー候補として整理しました。 / summary: 棚卸し資料を西尾さんへ送付",
      "入力: Viewer削除機能 confirmがScriptableで不安定だった / confirmation: メモとして保存します。 / summary: Viewer削除機能のconfirm不安定問題",
    ].join("\n"),
    hiddenContract: [
      "You create confirmation, user intent summary, and card summary from Japanese memo input.",
      "Return JSON only.",
      'Return exactly: {"confirmation":"","user_intent_summary":"","summary":""}',
      "Do not include verbose explanations or JSON reasoning.",
    ].join("\n"),
  },
  {
    key: "classification",
    label: "PARA / Domain分類",
    description: "PARAとDomainの分類方針です。",
    defaultUserPrompt: [
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
      "",
      "Examples:",
      "土曜日 久美子の職場近くでイベントあり お出かけするか検討 => para=area, domain=family",
      "タスク 棚卸し資料西尾さんへ送付 => para=area, domain=work",
      "Viewer削除機能 confirmがScriptableで不安定だった => para=resource, domain=creation",
      "PWAのGoogle Drive同期仕様を見直す => para=project, domain=creation",
    ].join("\n"),
    hiddenContract: [
      "You classify memo input into PARA and Domain attributes.",
      "Return JSON only.",
      'Return exactly: {"para":"","domain":""}',
      "Allowed para: project, area, resource, archive.",
      "Allowed domain: work, family, self, health, finance, learning, creation, life_admin, other.",
      "choose one para and one domain only. if unsure: para=area, domain=other.",
    ].join("\n"),
  },
  {
    key: "image_analysis",
    label: "画像解析",
    description: "写真・スクショ添付時の説明文、画像タグ、文字抽出の作り方です。",
    defaultUserPrompt: [
      "Analyze the attached image as context for a personal second-brain memo.",
      "",
      "Summary rules:",
      "- summary_80 should be concise Japanese, around 80 characters.",
      "- Describe what the image is useful for in the memo context.",
      "- Prefer concrete object names, project names, screen names, document names, people/place names when visible.",
      "- Do not over-infer hidden intent, unknown numbers, model names, specs, or conclusions.",
      "- If the image is a whiteboard/document/screenshot, summarize the visible subject rather than saying only 写真 or スクリーンショット.",
      "",
      "Tag rules:",
      "- image_tags should be max 5 searchable keywords.",
      "- Prefer proper nouns, model names, issue names, document names, screen names, places, and visible target objects.",
      "- Remove leading #.",
      "- Avoid generic tags such as 写真, 画像, メモ, スクショ unless they are the only meaningful option.",
      "- Preserve acronyms and product/model names exactly when visible.",
      "",
      "Visible text rules:",
      "- visible_text should include only important visible text, up to about 120 characters.",
      "- If there is too much text, extract only key phrases.",
      "- If text is unreadable, leave visible_text empty instead of guessing.",
      "",
      "Classification rules:",
      "- image_type should reflect the image itself: screenshot, document, whiteboard, object, scene, or other.",
      "- confidence should be high only when the image content is clear.",
    ].join("\n"),
    hiddenContract: [
      "You analyze one image for a Japanese second-brain app.",
      "Return JSON only.",
      'Return exactly: {"image_type":"screenshot","summary_80":"","image_tags":[],"visible_text":"","confidence":"medium"}',
      "Allowed image_type: screenshot, document, whiteboard, object, scene, other.",
      "Allowed confidence: high, medium, low.",
      "summary_80 must be a concise Japanese summary.",
      "image_tags must be an array of max 5 strings.",
      "visible_text must be key visible text only.",
      "Do not return markdown or explanations.",
    ].join("\n"),
  },
];

export function getPromptDefinitions() {
  return PROMPT_DEFINITIONS;
}

export function createDefaultPromptConfig(): CGMPPromptConfigFile {
  const now = new Date().toISOString();
  return {
    schema_version: CGMP_PROMPT_CONFIG_VERSION,
    kind: "cgmp_prompt_config",
    updated_at: now,
    prompts: Object.fromEntries(
      PROMPT_DEFINITIONS.map((definition) => [
        definition.key,
        {
          key: definition.key,
          userPrompt: definition.defaultUserPrompt,
          updated_at: now,
        },
      ])
    ) as Record<CGMPPromptKey, CGMPPromptOverride>,
  };
}

export function normalizePromptConfig(input: unknown): CGMPPromptConfigFile {
  const defaults = createDefaultPromptConfig();
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaults;
  const source = input as Partial<CGMPPromptConfigFile>;
  const sourcePrompts = source.prompts && typeof source.prompts === "object" ? source.prompts : {};
  const prompts = { ...defaults.prompts };
  for (const definition of PROMPT_DEFINITIONS) {
    const sourcePrompt = sourcePrompts[definition.key];
    const userPrompt = String(sourcePrompt?.userPrompt || "").trim();
    if (!userPrompt) continue;
    prompts[definition.key] = {
      key: definition.key,
      userPrompt,
      updated_at: String(sourcePrompt?.updated_at || source.updated_at || defaults.updated_at),
    };
  }
  return {
    schema_version: CGMP_PROMPT_CONFIG_VERSION,
    kind: "cgmp_prompt_config",
    updated_at: String(source.updated_at || defaults.updated_at),
    prompts,
  };
}

export function buildAnalyzePrompt(key: CGMPPromptKey, config?: CGMPPromptConfigFile) {
  const definition = PROMPT_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`UNKNOWN_PROMPT_KEY:${key}`);
  const userPrompt = config?.prompts?.[key]?.userPrompt?.trim() || definition.defaultUserPrompt;
  return [
    definition.hiddenContract,
    "",
    "User-editable guidance:",
    userPrompt,
    "",
    "Non-negotiable output contract:",
    definition.hiddenContract,
    "No markdown. No comments. No extra text.",
  ].join("\n");
}
