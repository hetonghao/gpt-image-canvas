#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const version = readJson(packageJsonPath).version;
const tauriConfig = readJson(tauriConfigPath);

if (tauriConfig.version !== version) {
  tauriConfig.version = version;
  writeJson(tauriConfigPath, tauriConfig);
}

const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const nextCargoToml = cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`);
if (nextCargoToml !== cargoToml) {
  fs.writeFileSync(cargoTomlPath, nextCargoToml);
}

process.stdout.write(`[desktop:sync-version] AI-Cove-Design desktop version ${version}\n`);
