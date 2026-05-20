import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = String(body.message ?? "").trim();

    if (!message) {
      return Response.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [
        {
          role: "system",
          content:
            "Extract 4-8 specific Japanese #tags. Preserve title/project names; remove spaces inside tags. Prefer distinctive terms over generic tags. Output only ASCII-comma-separated hashtags: #tag1,#tag2. No Japanese comma/newline/text.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const reply =
      completion.choices[0]?.message?.content ??
      "返答を生成できませんでした。";

    return Response.json({ reply });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "AI request failed" },
      { status: 500 }
    );
  }
}
