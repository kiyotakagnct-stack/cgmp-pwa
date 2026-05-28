import OpenAI from "openai";

type NoteReplyResponse = {
  reply: string;
  suggestedTags: string[];
};

type NoteReplyRequest = {
  content?: unknown;
  parentContent?: unknown;
  branchContent?: unknown;
  mode?: unknown;
  recentUpdates?: unknown;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBranchRecentUpdates(
  value: unknown
): value is Array<{ source: "user" | "ai"; content: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        ((item as { source?: unknown }).source === "user" ||
          (item as { source?: unknown }).source === "ai") &&
        typeof (item as { content?: unknown }).content === "string"
    )
  );
}

function buildBranchUpdatePrompt({
  content,
  parentContent,
  branchContent,
  recentUpdates,
}: {
  content: string;
  parentContent: string;
  branchContent: string;
  recentUpdates: Array<{ source: "user" | "ai"; content: string }>;
}) {
  const recentUpdatesBlock =
    recentUpdates.length > 0
      ? recentUpdates
          .map((update) => `- ${update.source === "user" ? "あなたの追記" : "AIの返事"}: ${update.content}`)
          .join("\n")
      : "なし";

  return [
    "あなたはLiving Notesの枝更新専用AIです。",
    "最優先で読むべきなのは『今回の追記』です。",
    "親メモや枝本文や直近の更新は背景情報であり、今回の追記の論点・違和感・問いだけに短く反応してください。",
    "親メモ全体の要約や『今日は多忙ですね』のような全体感想に逃げないでください。",
    "書かれていない人物関係や事情は補完しないでください。",
    "1〜3文、最大120〜180文字程度で、日本語で返してください。",
    "長い助言ではなく、短い反応・整理・問いかけにしてください。",
    "JSONのみを返し、reply と suggestedTags を含めてください。",
    "suggestedTags は今回の追記に寄せた2〜4個の短いタグ文字列配列にしてください。",
    "",
    `今回の追記:\n${content}`,
    "",
    `親メモ:\n${parentContent || "なし"}`,
    "",
    `枝本文:\n${branchContent || "なし"}`,
    "",
    `直近の更新:\n${recentUpdatesBlock}`,
    "",
    "返答条件:",
    "- 今回の追記に直接反応する",
    "- 親メモ全体の一般的な感想にしない",
    "- 具体的な論点を1つ拾う",
    "- 短く返す",
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "OPENAI_API_KEY_NOT_CONFIGURED" },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });
    const body = (await request.json().catch(() => ({}))) as NoteReplyRequest;
    const content = String(body.content ?? "").trim();
    const parentContent = String(body.parentContent ?? "").trim();
    const branchContent = String(body.branchContent ?? "").trim();
    const mode = String(body.mode ?? "").trim();
    const recentUpdates = isBranchRecentUpdates(body.recentUpdates)
      ? body.recentUpdates
      : [];

    if (!content) {
      return Response.json({ error: "content is required" }, { status: 400 });
    }

    const isBranchUpdate = mode === "branch_update";
    const systemPrompt = isBranchUpdate
      ? "あなたはLiving Notesの枝更新専用AIです。最優先で読むのは『今回の追記』です。親メモ・枝本文・直近の更新は補助情報であり、全体要約や『今日は多忙』のような一般論に逃げないでください。今回の追記に直接反応し、1〜3文、120〜180文字程度で、短い整理や問いかけを日本語で返してください。書かれていない背景は補完しないでください。JSONのみを返し、reply と suggestedTags を含めてください。suggestedTags は今回の追記に寄せた2〜4個の短いタグ文字列配列です。"
      : "あなたはLiving Notesの補助AIです。日本語で1〜3文、120〜180文字程度の短い返事だけを返してください。断定や長い助言は避け、メモを主役にして、軽い整理か短い問いかけに留めてください。JSONのみを返し、reply と suggestedTags を含めてください。suggestedTags は2〜4個の短いタグ文字列配列です。# は付けてもよいですが、無理に増やさないでください。";

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0,
      max_tokens: 180,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: isBranchUpdate
            ? buildBranchUpdatePrompt({
                content,
                parentContent,
                branchContent,
                recentUpdates,
              })
            : content,
        },
      ],
    });

    const raw = String(completion.choices[0]?.message?.content ?? "").trim();
    const parsed: unknown = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { reply?: unknown }).reply !== "string" ||
      !isStringArray((parsed as { suggestedTags?: unknown }).suggestedTags)
    ) {
      throw new Error("Invalid AI reply payload");
    }

    const response: NoteReplyResponse = {
      reply: (parsed as { reply: string }).reply.trim(),
      suggestedTags: (parsed as { suggestedTags: string[] }).suggestedTags,
    };

    return Response.json(response);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "AI request failed" }, { status: 500 });
  }
}
