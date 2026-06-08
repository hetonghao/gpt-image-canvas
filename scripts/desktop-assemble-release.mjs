#!/usr/bin/env node

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const defaultInputRoot = path.join(root, "desktop-release-inputs");
const defaultOutputDir = path.join(root, "desktop-release");

function isReleaseArtifact(fileName) {
  return (
    fileName.endsWith(".dmg") ||
    fileName.endsWith(".exe") ||
    fileName.endsWith(".exe.sig") ||
    fileName.endsWith(".app.tar.gz") ||
    fileName.endsWith(".app.tar.gz.sig") ||
    fileName.endsWith(".nsis.zip") ||
    fileName.endsWith(".nsis.zip.sig")
  );
}

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function mergeManifest(current, next, sourcePath) {
  if (!current) {
    return {
      version: next.version,
      notes: next.notes,
      pub_date: next.pub_date,
      platforms: { ...(next.platforms ?? {}) }
    };
  }

  if (current.version !== next.version) {
    throw new Error(`manifest version mismatch in ${sourcePath}: expected ${current.version}, got ${next.version}`);
  }

  for (const platform of Object.keys(next.platforms ?? {})) {
    if (Object.prototype.hasOwnProperty.call(current.platforms, platform)) {
      throw new Error(`duplicate updater platform in ${sourcePath}: ${platform}`);
    }
  }

  return {
    version: current.version,
    notes: current.notes || next.notes,
    pub_date: [current.pub_date, next.pub_date].filter(Boolean).sort().at(-1),
    platforms: {
      ...current.platforms,
      ...(next.platforms ?? {})
    }
  };
}

export async function assembleDesktopRelease({
  inputRoot = defaultInputRoot,
  outputDir = defaultOutputDir
} = {}) {
  const files = await listFilesRecursive(inputRoot);
  const manifestPaths = files.filter((filePath) => path.basename(filePath) === "latest.json");
  if (manifestPaths.length === 0) {
    throw new Error(`missing updater manifest under ${inputRoot}`);
  }

  let manifest = null;
  for (const manifestPath of manifestPaths) {
    const nextManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest = mergeManifest(manifest, nextManifest, manifestPath);
  }

  const artifactFiles = files.filter((filePath) => isReleaseArtifact(path.basename(filePath)));
  if (artifactFiles.length === 0) {
    throw new Error(`missing desktop release artifacts under ${inputRoot}`);
  }

  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });

  const copiedArtifacts = [];
  const copiedNames = new Set();
  for (const artifactFile of artifactFiles) {
    const artifactName = path.basename(artifactFile);
    if (copiedNames.has(artifactName)) {
      throw new Error(`duplicate desktop release artifact: ${artifactName}`);
    }
    copiedNames.add(artifactName);
    await cp(artifactFile, path.join(outputDir, artifactName));
    copiedArtifacts.push(artifactName);
  }

  await writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    artifacts: copiedArtifacts.sort(),
    platforms: Object.keys(manifest.platforms ?? {}).sort()
  };
}

export async function main(rawArgs = process.argv.slice(2)) {
  const [inputRoot = defaultInputRoot, outputDir = defaultOutputDir] = rawArgs;
  const assembled = await assembleDesktopRelease({ inputRoot, outputDir });
  process.stdout.write(
    `[desktop:assemble-release] assembled ${assembled.artifacts.length} artifacts for ${assembled.platforms.join(", ")}\n`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
