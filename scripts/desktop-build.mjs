#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

export function releaseArtifactNames(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") {
    const archName = arch === "arm64" ? "aarch64" : "x64";
    return {
      installer: "ai-cove-design-desktop-macos.dmg",
      updaterArchive: `ai-cove-design-desktop-macos-${archName}.app.tar.gz`,
      updaterSignature: `ai-cove-design-desktop-macos-${archName}.app.tar.gz.sig`,
      updaterPlatform: archName === "aarch64" ? "darwin-aarch64" : "darwin-x86_64"
    };
  }

  if (platform === "win32") {
    const archName = arch === "arm64" ? "aarch64" : "x86_64";
    return {
      installer: "ai-cove-design-desktop-windows.exe",
      updaterArchive: "ai-cove-design-desktop-windows.exe",
      updaterSignature: "ai-cove-design-desktop-windows.exe.sig",
      updaterPlatform: archName === "aarch64" ? "windows-aarch64" : "windows-x86_64"
    };
  }

  throw new Error(`Unsupported desktop release platform: ${platform}`);
}

export function buildLatestManifest({ version, downloadBaseUrl, notes, publishedAt, platforms }) {
  const baseUrl = downloadBaseUrl.replace(/\/+$/u, "");
  return {
    version,
    notes,
    pub_date: publishedAt,
    platforms: Object.fromEntries(
      platforms.map((platform) => [
        platform.platform,
        {
          signature: platform.signature,
          url: `${baseUrl}/${platform.updaterArchiveName}`
        }
      ])
    )
  };
}

export function mergeLatestManifest(existingManifest, currentManifest) {
  if (!existingManifest) {
    return currentManifest;
  }

  return {
    version: currentManifest.version,
    notes: currentManifest.notes,
    pub_date: currentManifest.pub_date,
    platforms: {
      ...(existingManifest.platforms ?? {}),
      ...(currentManifest.platforms ?? {})
    }
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function bundleProfile(args) {
  return args.includes("--debug") ? "debug" : "release";
}

export function resolveMacSigningIdentity(env = process.env) {
  const explicitIdentity = env.APPLE_SIGNING_IDENTITY?.trim();
  return explicitIdentity || "-";
}

export function tauriBuildEnvironment(env = process.env, platform = process.platform) {
  if (platform !== "darwin") {
    return env;
  }

  return {
    ...env,
    APPLE_SIGNING_IDENTITY: resolveMacSigningIdentity(env)
  };
}

async function findFirstExisting(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`None of the expected artifacts exist:\n${candidates.join("\n")}`);
}

async function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(await readFile(filePath, "utf8"));
}

async function collectCurrentPlatformArtifacts({ profile, version, releaseDir }) {
  const names = releaseArtifactNames();
  const bundleDir = path.join(root, "src-tauri", "target", profile, "bundle");

  if (process.platform === "darwin") {
    const installer = await findFirstExisting([path.join(bundleDir, "dmg", `AI-Cove-Design_${version}_aarch64.dmg`)]);
    const updaterArchive = await findFirstExisting([path.join(bundleDir, "macos", "AI-Cove-Design.app.tar.gz")]);
    const updaterSignature = `${updaterArchive}.sig`;

    await cp(installer, path.join(releaseDir, names.installer));
    await cp(updaterArchive, path.join(releaseDir, names.updaterArchive));
    await cp(updaterSignature, path.join(releaseDir, names.updaterSignature));

    return {
      platform: names.updaterPlatform,
      signature: (await readFile(updaterSignature, "utf8")).trim(),
      updaterArchiveName: names.updaterArchive
    };
  }

  if (process.platform === "win32") {
    const installer = await findFirstExisting([path.join(bundleDir, "nsis", `AI-Cove-Design_${version}_x64-setup.exe`)]);
    const updaterArchive = installer;
    const updaterSignature = `${installer}.sig`;

    await cp(installer, path.join(releaseDir, names.installer));
    if (names.updaterArchive !== names.installer) {
      await cp(updaterArchive, path.join(releaseDir, names.updaterArchive));
    }
    await cp(updaterSignature, path.join(releaseDir, names.updaterSignature));

    return {
      platform: names.updaterPlatform,
      signature: (await readFile(updaterSignature, "utf8")).trim(),
      updaterArchiveName: names.updaterArchive
    };
  }

  throw new Error(`Unsupported desktop release platform: ${process.platform}`);
}

function verifyMacAppBundle({ profile }) {
  if (process.platform !== "darwin") {
    return;
  }

  const appPath = path.join(root, "src-tauri", "target", profile, "bundle", "macos", "AI-Cove-Design.app");
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
}

export async function main(rawArgs = process.argv.slice(2)) {
  const tauriArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const profile = bundleProfile(tauriArgs);
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const version = packageJson.version;
  const releaseDir = path.join(root, "desktop-release");
  const downloadBaseUrl = process.env.AI_COVE_DESIGN_DOWNLOAD_BASE_URL ?? "https://ai-cove.com/downloads";
  const existingManifestPath = process.env.AI_COVE_DESIGN_EXISTING_LATEST_JSON ?? path.join(releaseDir, "latest.json");
  const existingManifest = await readJsonIfExists(existingManifestPath);

  await rm(releaseDir, { force: true, recursive: true });
  await mkdir(releaseDir, { recursive: true });

  run("pnpm", ["desktop:sync-version"]);
  run("pnpm", ["exec", "tauri", "build", ...tauriArgs], { env: tauriBuildEnvironment() });
  verifyMacAppBundle({ profile });

  const platform = await collectCurrentPlatformArtifacts({
    profile,
    releaseDir,
    version
  });

  const manifest = mergeLatestManifest(existingManifest, buildLatestManifest({
    version,
    downloadBaseUrl,
    notes: `AI-Cove-Design ${version}`,
    publishedAt: new Date().toISOString(),
    platforms: [platform]
  }));
  await writeFile(path.join(releaseDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  process.stdout.write(`[desktop:build] release artifacts written to ${releaseDir}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
