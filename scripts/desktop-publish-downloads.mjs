#!/usr/bin/env node

import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDesktopRelease } from "./desktop-release-validation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const defaultReleaseDir = path.join(root, "desktop-release");
const defaultDownloadsDir = path.resolve(root, "..", "new-api", "web", "default", "public", "downloads");
const requiredArtifacts = ["latest.json"];

function isReleaseArtifact(fileName) {
  return (
    fileName === "latest.json" ||
    fileName.endsWith(".dmg") ||
    fileName.endsWith(".exe") ||
    fileName.endsWith(".app.tar.gz") ||
    fileName.endsWith(".app.tar.gz.sig") ||
    fileName.endsWith(".nsis.zip") ||
    fileName.endsWith(".nsis.zip.sig")
  );
}

async function listReleaseArtifacts(releaseDir) {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isReleaseArtifact(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function syncDesktopDownloads({
  releaseDir = defaultReleaseDir,
  downloadsDir = process.env.AI_COVE_DESIGN_DOWNLOADS_DIR || defaultDownloadsDir
} = {}) {
  const artifacts = await listReleaseArtifacts(releaseDir);

  for (const requiredArtifact of requiredArtifacts) {
    if (!artifacts.includes(requiredArtifact)) {
      throw new Error(`missing desktop release artifact: ${requiredArtifact}`);
    }
  }

  const hasInstaller = artifacts.some((artifact) => artifact.endsWith(".dmg") || artifact.endsWith(".exe"));
  if (!hasInstaller) {
    throw new Error("missing desktop release installer artifact");
  }

  await validateDesktopRelease({ releaseDir });

  await mkdir(downloadsDir, { recursive: true });
  for (const artifact of artifacts) {
    await copyFile(path.join(releaseDir, artifact), path.join(downloadsDir, artifact));
  }

  return artifacts;
}

export async function main() {
  const copied = await syncDesktopDownloads();
  process.stdout.write(`[desktop:publish-downloads] copied ${copied.length} artifacts\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
