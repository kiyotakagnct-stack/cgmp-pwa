import JSZip from "jszip";

import { putImageBlob } from "@/lib/db/imageBlobStore";
import type { ImageAttachment } from "@/types/image";

import { loadAllRecords, upsertRecord } from "./storage";
import type { CGMPAction, CGMPDomain, CGMPPara, CGMPRecord } from "./types";
import { normalizeAction, normalizeDomain, normalizePara, parseTags, tagsToHashtags } from "./utils";

type ScriptableAttachment = {
  id?: string;
  type?: string;
  path?: string;
  original_path?: string;
  created_at?: string;
  image_type?: ImageAttachment["image_type"];
  summary_80?: string;
  image_tags?: unknown;
  visible_text?: string;
  confidence?: ImageAttachment["confidence"];
};

type ScriptableRecord = {
  schema_version?: string | number;
  id?: string;
  created_at?: string;
  updated_at?: string;
  raw_input?: string;
  title?: string;
  summary?: string;
  body?: string;
  action?: string;
  para?: string;
  domain?: string;
  tags?: unknown;
  date?: string;
  time?: string;
  all_day?: unknown;
  duration_minutes?: unknown;
  location?: string;
  confirmation?: string;
  note_tags?: string;
  note_index_line?: string;
  user_intent_summary?: string;
  ai?: Partial<CGMPRecord["ai"]>;
  attachments?: ScriptableAttachment[];
};

export type ScriptableImportResult = {
  imported: number;
  overwritten: number;
  skipped: number;
  imagesImported: number;
  errors: string[];
};

function toIsoFromJst(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return new Date().toISOString();
  const [, year, month, day, hour, minute, second = "00"] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`).toISOString();
}

function normalizeDate(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeTime(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : "";
}

function toBoolean(value: unknown) {
  if (value === true || value === false) return value;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function toDuration(value: unknown) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60;
}

function normalizeSourceTags(tags: unknown, fallback = "") {
  if (Array.isArray(tags)) return parseTags(tags.map((tag) => String(tag)));
  return parseTags(String(tags || fallback || ""));
}

function getRecordDir(recordPath: string) {
  const index = recordPath.lastIndexOf("/");
  return index >= 0 ? recordPath.slice(0, index) : "";
}

function findZipFile(zip: JSZip, baseDir: string, relativePath: string) {
  const candidates = [
    `${baseDir}/${relativePath}`.replace(/\/+/g, "/"),
    relativePath.replace(/^\/+/, ""),
  ];
  return candidates.map((path) => zip.file(path)).find(Boolean) || null;
}

function normalizeImageType(value: unknown): ImageAttachment["image_type"] {
  if (
    value === "screenshot" ||
    value === "document" ||
    value === "whiteboard" ||
    value === "object" ||
    value === "scene" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
}

function normalizeConfidence(value: unknown): ImageAttachment["confidence"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

function buildRecord(source: ScriptableRecord, attachments: ImageAttachment[]): CGMPRecord {
  const now = new Date().toISOString();
  const createdAt = toIsoFromJst(source.created_at || now);
  const updatedAt = toIsoFromJst(source.updated_at || source.created_at || now);
  const tags = normalizeSourceTags(source.tags, source.note_tags || "");
  const action = normalizeAction(source.action) as CGMPAction;
  const para = normalizePara(source.para) as CGMPPara;
  const domain = normalizeDomain(source.domain) as CGMPDomain;
  const title = String(source.title || source.raw_input || "（無題）").trim();
  const summary = String(source.summary || source.user_intent_summary || source.body || source.raw_input || "").trim();
  const body = String(source.body || source.raw_input || summary).trim();

  return {
    schema_version: 1,
    id: String(source.id || crypto.randomUUID()),
    created_at: createdAt,
    updated_at: updatedAt,
    raw_input: String(source.raw_input || body),
    title,
    summary,
    body,
    action,
    tags,
    para,
    domain,
    date: normalizeDate(source.date),
    time: normalizeTime(source.time),
    all_day: toBoolean(source.all_day),
    duration_minutes: toDuration(source.duration_minutes),
    location: String(source.location || ""),
    confirmation: String(source.confirmation || ""),
    note_tags: String(source.note_tags || tagsToHashtags(tags).join(" ")),
    note_index_line: String(source.note_index_line || ""),
    user_intent_summary: String(source.user_intent_summary || summary),
    ai_status: source.ai ? "done" : "none",
    ai_error: "",
    external_action_status: "none",
    external_target: "",
    external_registered_at: "",
    backup_status: "pending_backup",
    backup_retry_count: 0,
    backup_last_error: "",
    backup_next_retry_at: "",
    drive_file_id: "",
    last_backup_at: "",
    backup_checksum: "",
    attachments,
    ai: {
      model: String(source.ai?.model || "gpt-4.1-nano"),
      generated_at: toIsoFromJst(source.ai?.generated_at || createdAt),
      initial_title: String(source.ai?.initial_title || title),
      initial_tags: Array.isArray(source.ai?.initial_tags) ? source.ai.initial_tags.map((tag) => String(tag)) : tags,
      initial_date: normalizeDate(source.ai?.initial_date || source.date),
      initial_time: normalizeTime(source.ai?.initial_time || source.time),
      initial_action: normalizeAction(source.ai?.initial_action || action),
      initial_para: normalizePara(source.ai?.initial_para || para),
      initial_domain: normalizeDomain(source.ai?.initial_domain || domain),
      initial_summary: String(source.ai?.initial_summary || summary),
    },
  };
}

async function importRecordAttachments(zip: JSZip, recordPath: string, recordId: string, sourceAttachments: unknown) {
  const baseDir = getRecordDir(recordPath);
  const attachments: ImageAttachment[] = [];
  let imagesImported = 0;
  const errors: string[] = [];

  if (!Array.isArray(sourceAttachments)) {
    return { attachments, imagesImported, errors };
  }

  for (const item of sourceAttachments) {
    const source = item && typeof item === "object" ? (item as ScriptableAttachment) : {};
    if (source.type !== "image" || !source.id || !source.path) continue;

    const file = findZipFile(zip, baseDir, source.path);
    if (!file) {
      errors.push(`画像が見つかりません: ${recordId}/${source.id}`);
      continue;
    }

    const previewBlob = await file.async("blob");
    const previewBlobKey = `imageBlobs/${recordId}/${source.id}/preview.jpg`;
    await putImageBlob(previewBlobKey, previewBlob);
    imagesImported += 1;

    const imageTags = Array.isArray(source.image_tags)
      ? source.image_tags.map((tag) => String(tag || "").trim().replace(/^#+/, "")).filter(Boolean).slice(0, 5)
      : [];

    attachments.push({
      id: source.id,
      type: "image",
      previewBlobKey,
      originalFileName: source.path.split("/").pop() || "preview.jpg",
      mimeType: "image/jpeg",
      previewSizeBytes: previewBlob.size,
      created_at: toIsoFromJst(source.created_at || new Date().toISOString()),
      image_type: normalizeImageType(source.image_type),
      summary_80: String(source.summary_80 || "画像を添付しました。").slice(0, 120),
      image_tags: imageTags,
      visible_text: String(source.visible_text || "").slice(0, 180),
      confidence: normalizeConfidence(source.confidence),
      analysis_status: source.summary_80 || source.visible_text || imageTags.length > 0 ? "done" : "pending",
      backup_status: "pending_backup",
      backup_retry_count: 0,
      backup_last_error: "",
      backup_next_retry_at: "",
      previewDriveFileId: "",
      thumbnailDriveFileId: "",
      last_backup_at: "",
      backup_checksum: "",
    });
  }

  return { attachments, imagesImported, errors };
}

export async function importScriptableCgmpZip(file: File): Promise<ScriptableImportResult> {
  const zip = await JSZip.loadAsync(file);
  const recordFiles = Object.values(zip.files)
    .filter((entry) => !entry.dir && /(^|\/)record\.json$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const existingRecords = await loadAllRecords();
  const existingIds = new Set(existingRecords.map((record) => record.id));
  const result: ScriptableImportResult = {
    imported: 0,
    overwritten: 0,
    skipped: 0,
    imagesImported: 0,
    errors: [],
  };

  for (const recordFile of recordFiles) {
    try {
      const source = JSON.parse(await recordFile.async("text")) as ScriptableRecord;
      if (!source.id) {
        result.skipped += 1;
        result.errors.push(`idなしのrecordをスキップ: ${recordFile.name}`);
        continue;
      }

      const attachmentResult = await importRecordAttachments(zip, recordFile.name, source.id, source.attachments);
      const record = buildRecord(source, attachmentResult.attachments);
      await upsertRecord(record);
      if (existingIds.has(record.id)) {
        result.overwritten += 1;
      } else {
        result.imported += 1;
        existingIds.add(record.id);
      }
      result.imagesImported += attachmentResult.imagesImported;
      result.errors.push(...attachmentResult.errors);
    } catch (error) {
      result.skipped += 1;
      result.errors.push(
        `${recordFile.name}: ${error instanceof Error ? error.message : String(error || "IMPORT_RECORD_FAILED")}`
      );
    }
  }

  return result;
}
