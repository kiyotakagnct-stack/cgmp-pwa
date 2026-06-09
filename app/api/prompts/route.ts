import { NextResponse } from "next/server";

import { loadPromptConfigFromDriveWithMeta, savePromptConfigToDrive } from "@/lib/cgmp/drive-backup-server";
import { createDefaultPromptConfig, getPromptDefinitions, normalizePromptConfig } from "@/lib/cgmp/prompt-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function getClientPromptDefinitions() {
  return getPromptDefinitions().map(({ hiddenContract: _hiddenContract, ...definition }) => definition);
}

export async function GET() {
  try {
    const promptConfig = await loadPromptConfigFromDriveWithMeta();
    return NextResponse.json({
      ok: true,
      source: promptConfig.source,
      fileId: promptConfig.fileId,
      modifiedTime: promptConfig.modifiedTime,
      definitions: getClientPromptDefinitions(),
      config: promptConfig.config,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      source: "default",
      error: error instanceof Error ? error.message : "PROMPT_CONFIG_LOAD_FAILED",
      definitions: getClientPromptDefinitions(),
      config: createDefaultPromptConfig(),
    });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const config = normalizePromptConfig(payload?.config || payload);
    const saved = await savePromptConfigToDrive(config);
    return NextResponse.json({
      ok: true,
      source: "drive",
      fileId: saved.fileId,
      updatedAt: saved.updatedAt,
      config: saved.config,
      definitions: getClientPromptDefinitions(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "PROMPT_CONFIG_SAVE_FAILED",
      },
      { status: 500 }
    );
  }
}
