#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDesktopRelease } from "./desktop-release-validation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const defaultReleaseDir = path.join(root, "desktop-release");
const requiredPlatforms = ["darwin-aarch64", "windows-x86_64"];

export async function main(rawArgs = process.argv.slice(2)) {
  const [releaseDir = defaultReleaseDir] = rawArgs;
  const result = await validateDesktopRelease({
    releaseDir,
    requiredPlatforms
  });

  process.stdout.write(
    `[desktop:validate-release] ${result.version} valid for ${result.platforms.join(", ")}\n`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
