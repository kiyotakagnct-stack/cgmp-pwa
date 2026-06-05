import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function trimSha(value: string | undefined) {
  return value ? value.slice(0, 7) : "";
}

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

export async function GET() {
  const owner = readEnv("VERCEL_GIT_REPO_OWNER", "NEXT_PUBLIC_VERCEL_GIT_REPO_OWNER");
  const slug = readEnv("VERCEL_GIT_REPO_SLUG", "NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG");
  const vercelUrl = readEnv("VERCEL_URL", "NEXT_PUBLIC_VERCEL_URL");
  const deploymentUrl = vercelUrl ? `https://${vercelUrl}` : "";
  const commitMessage = readEnv("VERCEL_GIT_COMMIT_MESSAGE", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE");
  const commitSha = readEnv("VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA");
  const commitRef = readEnv("VERCEL_GIT_COMMIT_REF", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF");
  const hasGitInfo = Boolean(commitMessage || commitSha || commitRef || owner || slug);

  return NextResponse.json(
    {
      ok: hasGitInfo,
      commitMessage: commitMessage || (hasGitInfo ? "" : "VercelのGit System Environment Variablesが取得できませんでした。"),
      commitSha: trimSha(commitSha),
      commitRef,
      repository: owner && slug ? `${owner}/${slug}` : "",
      environment: readEnv("VERCEL_ENV", "NEXT_PUBLIC_VERCEL_ENV"),
      deploymentUrl,
      deploymentId: readEnv("VERCEL_DEPLOYMENT_ID", "NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID"),
      region: readEnv("VERCEL_REGION", "NEXT_PUBLIC_VERCEL_REGION"),
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
