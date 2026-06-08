import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function artifactNameFromUrl(url, platform) {
  try {
    return path.basename(new URL(url).pathname);
  } catch {
    throw new Error(`invalid updater url for ${platform}: ${url}`);
  }
}

async function readTrimmed(filePath) {
  return (await readFile(filePath, "utf8")).trim();
}

export async function validateDesktopRelease({
  releaseDir,
  requiredPlatforms = []
}) {
  const manifestPath = path.join(releaseDir, "latest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`invalid desktop updater manifest: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(manifest)) {
    throw new Error("desktop updater manifest must be a JSON object");
  }
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    throw new Error("desktop updater manifest is missing version");
  }
  if (!isRecord(manifest.platforms) || Object.keys(manifest.platforms).length === 0) {
    throw new Error("desktop updater manifest is missing platforms");
  }

  const artifactNames = new Set((await readdir(releaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name));

  for (const requiredPlatform of requiredPlatforms) {
    if (!Object.prototype.hasOwnProperty.call(manifest.platforms, requiredPlatform)) {
      throw new Error(`missing updater platform: ${requiredPlatform}`);
    }
  }

  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (!isRecord(entry)) {
      throw new Error(`updater platform entry must be an object: ${platform}`);
    }
    if (typeof entry.signature !== "string" || entry.signature.trim() === "") {
      throw new Error(`missing updater signature for ${platform}`);
    }
    if (typeof entry.url !== "string" || entry.url.trim() === "") {
      throw new Error(`missing updater url for ${platform}`);
    }

    const archiveName = artifactNameFromUrl(entry.url, platform);
    if (!artifactNames.has(archiveName)) {
      throw new Error(`missing updater archive for ${platform}: ${archiveName}`);
    }

    const signatureName = `${archiveName}.sig`;
    if (!artifactNames.has(signatureName)) {
      throw new Error(`missing updater signature file for ${platform}: ${signatureName}`);
    }
    const signature = await readTrimmed(path.join(releaseDir, signatureName));
    if (signature !== entry.signature.trim()) {
      throw new Error(`updater signature mismatch for ${platform}: ${signatureName}`);
    }

    if (platform.startsWith("darwin-") && !artifactNames.has("ai-cove-design-desktop-macos.dmg")) {
      throw new Error("missing desktop installer for darwin: ai-cove-design-desktop-macos.dmg");
    }
    if (platform.startsWith("windows-") && !artifactNames.has("ai-cove-design-desktop-windows.exe")) {
      throw new Error("missing desktop installer for windows: ai-cove-design-desktop-windows.exe");
    }
  }

  return {
    platforms: Object.keys(manifest.platforms).sort(),
    version: manifest.version
  };
}
