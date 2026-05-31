import {
  getEmbeddingIndex,
  loadEmbeddingIndex,
  upsertEmbeddingIndex,
} from "./storage";
import type { CGMPEmbeddingIndex, CGMPRecord } from "./types";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const SEMANTIC_STRONG_THRESHOLD = 0.68;
export const SEMANTIC_CANDIDATE_THRESHOLD = 0.45;

export type EmbeddingProvider = {
  embed(text: string): Promise<number[]>;
};

export type SimilarRecord = {
  record: CGMPRecord;
  score: number;
  level: "strong" | "candidate";
};

export class ApiEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string) {
    const response = await fetch("/api/embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, model: EMBEDDING_MODEL }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      vector?: number[];
      error?: string;
    };
    if (!response.ok || !payload.ok || !Array.isArray(payload.vector)) {
      throw new Error(payload.error || "EMBEDDING_REQUEST_FAILED");
    }
    return payload.vector;
  }
}

export function buildEmbeddingText(record: CGMPRecord) {
  return [
    `title: ${record.title || ""}`,
    `summary: ${record.summary || ""}`,
    `raw_input: ${record.raw_input || ""}`,
    `tags: ${(record.tags || []).join(" ")}`,
    `domain: ${record.domain || ""}`,
    `para: ${record.para || ""}`,
    `action: ${record.action || ""}`,
  ].join("\n").trim();
}

export async function hashEmbeddingText(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeVector(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export async function ensureRecordEmbedding({
  record,
  provider,
  force = false,
}: {
  record: CGMPRecord;
  provider: EmbeddingProvider;
  force?: boolean;
}) {
  const embeddingText = buildEmbeddingText(record);
  const hash = await hashEmbeddingText(embeddingText);
  const current = await getEmbeddingIndex(record.id);
  if (!force && current?.embedding_text_hash === hash && current.model === EMBEDDING_MODEL) {
    return { index: current, skipped: true, hash };
  }

  console.debug("[cgmp:embedding] embedding generation started", {
    record_id: record.id,
    model: EMBEDDING_MODEL,
    embedding_text_hash: hash,
  });
  const vector = normalizeVector(await provider.embed(embeddingText));
  const index: CGMPEmbeddingIndex = {
    record_id: record.id,
    vector,
    model: EMBEDDING_MODEL,
    dimensions: vector.length,
    embedding_text_hash: hash,
    source_updated_at: record.updated_at || record.created_at,
    embedded_at: new Date().toISOString(),
  };
  await upsertEmbeddingIndex(index);
  console.debug("[cgmp:embedding] embedding generation succeeded", {
    record_id: record.id,
    model: index.model,
    dimensions: index.dimensions,
    embedding_text_hash: index.embedding_text_hash,
  });
  return { index, skipped: false, hash };
}

export async function searchSimilarByVector({
  vector,
  records,
  excludeRecordId = "",
  limit = 20,
  threshold = SEMANTIC_CANDIDATE_THRESHOLD,
}: {
  vector: number[];
  records: CGMPRecord[];
  excludeRecordId?: string;
  limit?: number;
  threshold?: number;
}) {
  const index = await loadEmbeddingIndex();
  const recordById = new Map(records.map((record) => [record.id, record]));
  const results: SimilarRecord[] = [];
  for (const item of index) {
    if (item.record_id === excludeRecordId) continue;
    const record = recordById.get(item.record_id);
    if (!record) continue;
    const score = cosineSimilarity(vector, item.vector);
    if (score < threshold) continue;
    results.push({
      record,
      score,
      level: score >= SEMANTIC_STRONG_THRESHOLD ? "strong" : "candidate",
    });
  }
  results.sort((left, right) => right.score - left.score);
  console.debug("[cgmp:embedding] semantic search completed", {
    index_count: index.length,
    candidate_count: results.length,
    threshold,
  });
  return results.slice(0, limit);
}

export async function searchSimilarByText({
  text,
  records,
  provider,
  limit = 20,
  threshold = SEMANTIC_CANDIDATE_THRESHOLD,
}: {
  text: string;
  records: CGMPRecord[];
  provider: EmbeddingProvider;
  limit?: number;
  threshold?: number;
}) {
  const vector = normalizeVector(await provider.embed(text));
  return searchSimilarByVector({ vector, records, limit, threshold });
}
