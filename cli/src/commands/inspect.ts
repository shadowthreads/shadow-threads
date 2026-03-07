import type { Command } from 'commander';
import { ShadowClient } from '../client/api-client';
import { resolveServerURL } from '../config/config';
import { printJson } from '../utils/output';

export function registerInspectCommand(program: Command): void {
  const inspect = program.command('inspect').description('Inspect revisions, artifacts, and executions');

  inspect
    .command('revision')
    .description('Fetch a revision by hash')
    .argument('<id>', 'Revision hash')
    .action(async (id: string) => {
      const serverURL = await resolveServerURL({
        flagValue: program.opts<{ server?: string }>().server,
      });
      const client = new ShadowClient(serverURL);
      const result = await client.getRevision(id);
      printJson(result);
    });

  inspect
    .command('artifact')
    .description('Fetch an artifact by bundle hash and package id')
    .argument('<hash>', 'Artifact bundle hash')
    .requiredOption('--package <packageId>', 'Package id required by the current server API')
    .action(async (hash: string, options: { package: string }) => {
      const serverURL = await resolveServerURL({
        flagValue: program.opts<{ server?: string }>().server,
      });
      const client = new ShadowClient(serverURL);
      const result = await client.getArtifact(hash, options.package);
      printJson(result);
    });

  inspect
    .command('execution')
    .description('Fetch an execution by id')
    .argument('<id>', 'Execution id')
    .action(async (id: string) => {
      const serverURL = await resolveServerURL({
        flagValue: program.opts<{ server?: string }>().server,
      });
      const client = new ShadowClient(serverURL);
      const result = await client.getExecution(id);
      printJson(result);
    });
}
