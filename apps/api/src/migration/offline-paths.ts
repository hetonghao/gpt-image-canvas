import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DATABASE_FILE_NAME, isOutputInsideInput } from "./sqlite.js";
import type { FailureCode, MigrationOptions } from "./types.js";

export type MigrationPaths = {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly reportDir: string;
};

export function resolveMigrationPaths(options: MigrationOptions): MigrationPaths {
  const outputDir = resolve(options.outputDir);
  return {
    inputDir: resolve(options.inputDir),
    outputDir,
    reportDir: resolve(options.reportDir ?? join(dirname(outputDir), `${basename(outputDir)}-report`))
  };
}

export function validateMigrationPaths(paths: MigrationPaths): FailureCode | undefined {
  if (!paths.inputDir || !paths.outputDir || !existsSync(paths.inputDir) || !statSync(paths.inputDir).isDirectory()) return "input_invalid";
  if (!existsSync(join(paths.inputDir, DATABASE_FILE_NAME))) return "input_invalid";
  if (isOutputInsideInput(paths.inputDir, paths.outputDir) || isOutputInsideInput(paths.inputDir, paths.reportDir) || paths.outputDir === paths.reportDir) return "input_invalid";
  if (existsSync(paths.reportDir)) return "report_protected";
  return undefined;
}
