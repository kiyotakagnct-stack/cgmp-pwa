import {
  cosineSimilarity,
  EMBEDDING_MODEL,
  hashEmbeddingText,
  normalizeVector,
  type EmbeddingProvider,
} from "./embedding";
import {
  DEFAULT_SEMANTIC_ICON_THRESHOLD,
  SEMANTIC_ICON_DICTIONARY_VERSION,
  createDefaultSemanticIconDictionary,
} from "./semantic-icon-defaults";
import {
  loadSemanticIconDictionary,
  loadSemanticIconIndex,
  saveSemanticIconDictionary,
  upsertSemanticIconIndex,
} from "./storage";
import type {
  CGMPAction,
  CGMPRecord,
  CGMPSemanticIcon,
  CGMPSemanticIconEntry,
  CGMPSemanticIconIndex,
} from "./types";

export { DEFAULT_SEMANTIC_ICON_THRESHOLD, SEMANTIC_ICON_DICTIONARY_VERSION };

type IconInferenceResult = {
  icon: CGMPSemanticIcon;
  matchedEntry?: CGMPSemanticIconEntry;
  source: "embedding" | "keyword" | "action_default";
};

const ACTION_DEFAULTS: Record<CGMPAction, { emoji: string; key: string; label: string }> = {
  note: { emoji: "📝", key: "action_note", label: "メモ" },
  reminder: { emoji: "✅", key: "action_reminder", label: "タスク" },
  calendar: { emoji: "📅", key: "action_calendar", label: "予定" },
  unclear: { emoji: "❓", key: "action_unclear", label: "未分類" },
};

export function buildSemanticIconText(entry: CGMPSemanticIconEntry) {
  return [
    `emoji: ${entry.emoji}`,
    `label: ${entry.label}`,
    `description: ${entry.description}`,
    `keywords: ${entry.keywords.join(" ")}`,
    `examples: ${entry.examples.join(" / ")}`,
  ].join("\n");
}

export function buildRecordIconText(record: CGMPRecord) {
  const attachmentText = (record.attachments || [])
    .map((attachment) =>
      [attachment.summary_80, ...(attachment.image_tags || []), attachment.visible_text].filter(Boolean).join(" ")
    )
    .filter(Boolean)
    .join("\n");
  return [
    `title: ${record.title || ""}`,
    `summary: ${record.summary || ""}`,
    `body: ${record.body || ""}`,
    `raw_input: ${record.raw_input || ""}`,
    `tags: ${(record.tags || []).join(" ")}`,
    `image: ${attachmentText}`,
    `domain: ${record.domain || ""}`,
    `para: ${record.para || ""}`,
    `action: ${record.action || ""}`,
  ].join("\n").trim();
}

function createIcon({
  emoji,
  key,
  label,
  source,
  score,
  textHash,
}: {
  emoji: string;
  key: string;
  label: string;
  source: CGMPSemanticIcon["source"];
  score: number;
  textHash: string;
}): CGMPSemanticIcon {
  return {
    emoji,
    key,
    label,
    source,
    score,
    model: source === "action_default" ? "action-default" : EMBEDDING_MODEL,
    assigned_at: new Date().toISOString(),
    text_hash: textHash,
    dictionary_version: SEMANTIC_ICON_DICTIONARY_VERSION,
  };
}

export function getActionDefaultSemanticIcon(record: Pick<CGMPRecord, "action">, textHash = ""): CGMPSemanticIcon {
  const fallback = ACTION_DEFAULTS[record.action || "unclear"] || ACTION_DEFAULTS.unclear;
  return createIcon({
    ...fallback,
    source: "action_default",
    score: 0,
    textHash,
  });
}

function textIncludesKeyword(recordText: string, entry: CGMPSemanticIconEntry) {
  const normalized = recordText.toLowerCase();
  return entry.keywords.some((keyword) => {
    const value = keyword.trim().toLowerCase();
    return value.length > 0 && normalized.includes(value);
  });
}

export async function ensureSemanticIconDictionaryIndex({
  provider,
  force = false,
  onProgress,
}: {
  provider: EmbeddingProvider;
  force?: boolean;
  onProgress?: (progress: { total: number; completed: number; currentLabel: string }) => void;
}) {
  const dictionary = await loadSemanticIconDictionary();
  const existing = await loadSemanticIconIndex();
  const existingByKey = new Map(existing.map((item) => [item.key, item]));
  const enabledEntries = dictionary.filter((entry) => entry.enabled);
  const indexes: CGMPSemanticIconIndex[] = [];
  let completed = 0;

  for (const entry of enabledEntries) {
    const text = buildSemanticIconText(entry);
    const hash = await hashEmbeddingText(text);
    const current = existingByKey.get(entry.key);
    if (
      !force &&
      current?.icon_text_hash === hash &&
      current.model === EMBEDDING_MODEL &&
      current.dictionary_version === SEMANTIC_ICON_DICTIONARY_VERSION
    ) {
      indexes.push(current);
      completed += 1;
      onProgress?.({ total: enabledEntries.length, completed, currentLabel: entry.label });
      continue;
    }

    const vector = normalizeVector(await provider.embed(text));
    const index: CGMPSemanticIconIndex = {
      key: entry.key,
      vector,
      model: EMBEDDING_MODEL,
      dimensions: vector.length,
      icon_text_hash: hash,
      source_updated_at: entry.updated_at,
      embedded_at: new Date().toISOString(),
      dictionary_version: SEMANTIC_ICON_DICTIONARY_VERSION,
    };
    await upsertSemanticIconIndex(index);
    indexes.push(index);
    completed += 1;
    onProgress?.({ total: enabledEntries.length, completed, currentLabel: entry.label });
  }

  return { dictionary, index: indexes };
}

export async function inferSemanticIconForRecord({
  record,
  provider,
  threshold = DEFAULT_SEMANTIC_ICON_THRESHOLD,
  recordVector,
}: {
  record: CGMPRecord;
  provider: EmbeddingProvider;
  threshold?: number;
  recordVector?: number[];
}): Promise<IconInferenceResult> {
  const text = buildRecordIconText(record);
  const textHash = await hashEmbeddingText(text);
  const dictionary = await loadSemanticIconDictionary();
  const index = await loadSemanticIconIndex();
  const enabledEntries = dictionary.filter((entry) => entry.enabled);
  const entryByKey = new Map(enabledEntries.map((entry) => [entry.key, entry]));

  if (index.length > 0) {
    const vector = recordVector ? normalizeVector(recordVector) : normalizeVector(await provider.embed(text));
    let best: { entry: CGMPSemanticIconEntry; score: number } | null = null;
    for (const item of index) {
      const entry = entryByKey.get(item.key);
      if (!entry) continue;
      const score = cosineSimilarity(vector, item.vector);
      if (!best || score > best.score) best = { entry, score };
    }
    if (best && best.score >= threshold) {
      return {
        matchedEntry: best.entry,
        source: "embedding",
        icon: createIcon({
          emoji: best.entry.emoji,
          key: best.entry.key,
          label: best.entry.label,
          source: "embedding",
          score: best.score,
          textHash,
        }),
      };
    }
  }

  const keywordEntry = enabledEntries.find((entry) => textIncludesKeyword(text, entry));
  if (keywordEntry) {
    return {
      matchedEntry: keywordEntry,
      source: "keyword",
      icon: createIcon({
        emoji: keywordEntry.emoji,
        key: keywordEntry.key,
        label: keywordEntry.label,
        source: "keyword",
        score: 1,
        textHash,
      }),
    };
  }

  return {
    source: "action_default",
    icon: getActionDefaultSemanticIcon(record, textHash),
  };
}

export function getRecordSemanticIcon(record: CGMPRecord) {
  if (record.icon?.emoji) return record.icon.emoji;
  const dictionary = createDefaultSemanticIconDictionary();
  const text = buildRecordIconText(record);
  const keywordEntry = dictionary.find((entry) => textIncludesKeyword(text, entry));
  return keywordEntry?.emoji || getActionDefaultSemanticIcon(record).emoji;
}

export async function resetSemanticIconDictionary() {
  const dictionary = createDefaultSemanticIconDictionary();
  await saveSemanticIconDictionary(dictionary);
  return dictionary;
}
