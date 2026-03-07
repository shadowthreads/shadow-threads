import path from 'node:path';
import type { Command } from 'commander';
import { ShadowClient } from '../client/api-client';
import { resolveServerURL } from '../config/config';
import { copyFileTo } from '../utils/fs';

export function registerMigrateCommand(program: Command): void {
  const migrate = program.command('migrate').description('Migration package utilities');

  migrate
    .command('export')
    .description('Export a migration package for the provided root revision hash')
    .argument('<revision-id>', 'Root revision hash')
    .action(async (revisionId: string) => {
      const serverURL = await resolveServerURL({
        flagValue: program.opts<{ server?: string }>().server,
      });
      const client = new ShadowClient(serverURL);
      const result = await client.exportMigration(revisionId);
      const destination = path.resolve(process.cwd(), 'migration.zip');

      await copyFileTo(result.zipPath, destination);

      console.log('Migration exported');
      console.log(`file: ${destination}`);
      console.log(`rootRevisionHash: ${result.manifest.rootRevisionHash}`);
      console.log(`artifactCount: ${result.manifest.artifactCount}`);
      console.log(`revisionCount: ${result.manifest.revisionCount}`);
    });
}
