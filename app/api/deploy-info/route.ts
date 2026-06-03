import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function trimSha(value: string | undefined) {
  return value ? value.slice(0, 7) : "";
}

export async function GET() {
  const owner = process.env.VERCEL_GIT_REPO_OWNER || "";
  const slug = process.env.VERCEL_GIT_REPO_SLUG || "";
  const deploymentUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";

  return NextResponse.json({
    ok: true,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || "",
    commitSha: trimSha(process.env.VERCEL_GIT_COMMIT_SHA),
    commitRef: process.env.VERCEL_GIT_COMMIT_REF || "",
    repository: owner && slug ? `${owner}/${slug}` : "",
    environment: process.env.VERCEL_ENV || "",
    deploymentUrl,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || "",
    region: process.env.VERCEL_REGION || "",
    generatedAt: new Date().toISOString(),
  });
}
