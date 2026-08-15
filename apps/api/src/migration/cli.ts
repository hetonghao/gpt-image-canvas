import { runOfflineMigration } from "./offline-migration.js";
import type { MigrationOptions } from "./types.js";

class CliUsageError extends Error {
  readonly name = "CliUsageError";
}

function parseArguments(args: readonly string[]): MigrationOptions {
  let inputDir: string | undefined;
  let outputDir: string | undefined;
  let reportDir: string | undefined;
  let sourceBackupId: string | undefined;
  let approveWarnings = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--input":
        inputDir = requiredValue(args, ++index, argument);
        break;
      case "--output":
        outputDir = requiredValue(args, ++index, argument);
        break;
      case "--report-dir":
        reportDir = requiredValue(args, ++index, argument);
        break;
      case "--source-backup-id":
        sourceBackupId = requiredValue(args, ++index, argument);
        break;
      case "--approve-warnings":
        approveWarnings = true;
        break;
      default:
        throw new CliUsageError(`unknown argument: ${argument ?? ""}`);
    }
  }
  if (!inputDir || !outputDir) throw new CliUsageError("--input and --output are required");
  return {
    inputDir,
    outputDir,
    ...(reportDir === undefined ? {} : { reportDir }),
    ...(sourceBackupId === undefined ? {} : { sourceBackupId }),
    ...(approveWarnings ? { approveWarnings: true } : {})
  };
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new CliUsageError(`${option} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const report = await runOfflineMigration(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ status: report.status, machineReport: report.reportFiles.machine, humanReport: report.reportFiles.human })}\n`);
  if (report.status !== "ready") process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  if (error instanceof CliUsageError) {
    console.error(`Usage error: ${error.message}`);
    process.exitCode = 2;
  } else if (error instanceof Error) {
    console.error("Offline migration failed.");
    process.exitCode = 1;
  } else {
    console.error("Offline migration failed.");
    process.exitCode = 1;
  }
}
