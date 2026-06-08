#!/usr/bin/env node

import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const sidecarRoot = path.join(root, "src-tauri", "resources", "sidecar");
const apiRoot = path.join(sidecarRoot, "api");
const webDistRoot = path.join(sidecarRoot, "web-dist");
const nodeRoot = path.join(sidecarRoot, "node");
const nodeFileName = process.platform === "win32" ? "node.exe" : "node";

export function apiDeployArgs(targetRoot) {
  return [
    "--filter",
    "@gpt-image-canvas/api",
    "deploy",
    "--prod",
    "--config.node-linker=hoisted",
    targetRoot
  ];
}

export function nodeStripArgs(nodePath, platform = process.platform) {
  if (platform !== "darwin") {
    return null;
  }

  return ["-x", nodePath];
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function stripCopiedNodeBinary(nodePath) {
  const args = nodeStripArgs(nodePath);
  if (!args) {
    return;
  }

  const result = spawnSync("strip", args, {
    cwd: root,
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`strip ${args.join(" ")} failed: ${output || result.status || "unknown error"}`);
  }
}

export async function main() {
  await rm(sidecarRoot, { force: true, recursive: true });
  await mkdir(sidecarRoot, { recursive: true });

  run("pnpm", ["build"]);
  run("pnpm", apiDeployArgs(apiRoot));

  await cp(path.join(root, "apps", "web", "dist"), webDistRoot, { recursive: true });
  await mkdir(nodeRoot, { recursive: true });
  const copiedNodePath = path.join(nodeRoot, nodeFileName);
  await cp(process.execPath, copiedNodePath);
  stripCopiedNodeBinary(copiedNodePath);
  if (process.platform !== "win32") {
    await chmod(copiedNodePath, 0o755);
  }

  await writeFile(
    path.join(sidecarRoot, "manifest.json"),
    `${JSON.stringify(
      {
        apiEntry: "api/dist/index.js",
        node: `node/${nodeFileName}`,
        webDist: "web-dist"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(`[desktop:prepare-sidecar] prepared ${sidecarRoot}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
