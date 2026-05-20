"use client";

import { useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type AnalyzeResult = {
  action: { a: string } | null;
  date: { dt: string | null } | null;
  tag: { t: string[] } | null;
  title: { ttl: string } | null;
  errors: Partial<Record<"action" | "date" | "tag" | "title", string>>;
};

const initialMessages: Message[] = [
  {
    role: "assistant",
    content:
      "こんにちは。Magic Journal Chatです。メッセージを送るとOpenAI API経由で返答します。",
  },
];

const errorMessage =
  "エラーが発生しました。APIキー、.env.local、または /api/chat の設定を確認してください。";

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isSending, setIsSending] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) {
      return;
    }

    setInput("");
    setIsSending(true);
    setMessages((current) => [...current, { role: "user", content: text }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data: unknown = await response.json();
      const reply =
        typeof data === "object" &&
        data !== null &&
        "reply" in data &&
        typeof (data as { reply?: unknown }).reply === "string"
          ? (data as { reply: string }).reply
          : "返答を取得できませんでした。";

      setMessages((current) => [
        ...current,
        { role: "assistant", content: reply },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: errorMessage },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function handleAnalyze() {
    const text = input.trim();
    if (!text || isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeResult(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data: unknown = await response.json();
      const parsed = data as Partial<AnalyzeResult>;
      setAnalyzeResult({
        action: parsed.action ?? null,
        date: parsed.date ?? null,
        tag: parsed.tag ?? null,
        title: parsed.title ?? null,
        errors: parsed.errors ?? {},
      });
    } catch {
      setAnalyzeResult({
        action: null,
        date: null,
        tag: null,
        title: null,
        errors: {
          action: "request failed",
          date: "request failed",
          tag: "request failed",
          title: "request failed",
        },
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
        <header className="mb-6 border-b border-zinc-800 pb-4">
          <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
            Magic Journal
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Magic Journal Chat
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            /api/chat 経由で OpenAI に送信するシンプルなチャット画面です。
          </p>
        </header>

        <section className="flex-1 space-y-4 overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-2xl shadow-black/30">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-950"
                  : "mr-auto max-w-[85%] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100"
              }
            >
              <p className="whitespace-pre-wrap leading-6">{message.content}</p>
            </div>
          ))}

          {isSending ? (
            <div className="mr-auto max-w-[85%] rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-400">
              <p>AIが考えています...</p>
            </div>
          ) : null}
        </section>

        <form
          className="mt-4 flex gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <input
            className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="メッセージを入力..."
            disabled={isSending}
            aria-label="メッセージ入力"
          />
          <button
            className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            type="submit"
            disabled={isSending || input.trim().length === 0}
          >
            送信
          </button>
        </form>

        <section className="mt-4 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-100">AI解析テスト</h2>
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={isSending || isAnalyzing || input.trim().length === 0}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              解析する
            </button>
          </div>

          <div className="mt-4 space-y-2 text-sm text-zinc-300">
            <p>
              action:{" "}
              {isAnalyzing ? "処理中..." : JSON.stringify(analyzeResult?.action ?? null)}
            </p>
            <p>
              date:{" "}
              {isAnalyzing ? "処理中..." : JSON.stringify(analyzeResult?.date ?? null)}
            </p>
            <p>
              tag:{" "}
              {isAnalyzing ? "処理中..." : JSON.stringify(analyzeResult?.tag ?? null)}
            </p>
            <p>
              title:{" "}
              {isAnalyzing ? "処理中..." : JSON.stringify(analyzeResult?.title ?? null)}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
