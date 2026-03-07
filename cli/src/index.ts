#!/usr/bin/env node

import { Command } from 'commander';
import { registerCaptureCommand } from './commands/capture';
import { registerInitCommand } from './commands/init';
import { registerInspectCommand } from './commands/inspect';
import { registerMigrateCommand } from './commands/migrate';
import { registerReplayCommand } from './commands/replay';
import { EXIT_CODE_SUCCESS, getExitCode, toErrorMessage } from './utils/errors';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('shadow')
    .description('Shadow Threads CLI')
    .version('0.1.0')
    .option('--server <url>', 'Shadow Threads server URL')
    .showHelpAfterError()
    .showSuggestionAfterError();

  registerInitCommand(program);
  registerCaptureCommand(program);
  registerInspectCommand(program);
  registerReplayCommand(program);
  registerMigrateCommand(program);

  await program.parseAsync(process.argv);
  process.exit(EXIT_CODE_SUCCESS);
}

void main().catch((error: unknown) => {
  console.error(toErrorMessage(error));
  process.exit(getExitCode(error));
});
