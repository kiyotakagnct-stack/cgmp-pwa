import { NextResponse } from "next/server";

import { loadPromptConfigFromDrive, savePromptConfigToDrive } from "@/lib/cgmp/drive-backup-server";
import { createDefaultPromptConfig, getPromptDefinitions, normalizePromptConfig } from "@/lib/cgmp/prompt-config";

export const runtime = "nodejs";

function getClientPromptDefinitions() {
  return getPromptDefinitions().map(({ hiddenContract: _hiddenContract, ...definition }) => definition);
}

export async function GET() {
  try {
    const config = await loadPromptConfigFromDrive();
    return NextResponse.json({
      ok: true,
      source: "drive",
      definitions: getClientPromptDefinitions(),
      config,
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
