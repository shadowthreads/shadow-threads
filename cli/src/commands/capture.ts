import path from 'node:path';
import type { Command } from 'commander';
import { ShadowClient, artifactCreateBodySchema } from '../client/api-client';
import { resolveServerURL } from '../config/config';
import { readJsonFile } from '../utils/fs';

export function registerCaptureCommand(program: Command): void {
  program
    .command('capture')
    .description('Capture a full artifact bundle request body from a JSON file')
    .argument('<file>', 'Path to a JSON file containing the full artifact request body')
    .action(async (file: string) => {
      const serverURL = await resolveServerURL({
        flagValue: program.opts<{ server?: string }>().server,
      });
      const requestPath = path.resolve(process.cwd(), file);
      const raw = await readJsonFile(requestPath);
      const payload = artifactCreateBodySchema.parse(raw);
      const client = new ShadowClient(serverURL);
      const result = await client.createArtifact(payload);

      console.log('Artifact stored');
      console.log(`bundleHash: ${result.bundleHash}`);
    });
}
