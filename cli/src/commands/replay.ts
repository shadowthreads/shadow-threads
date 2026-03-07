import type { Command } from 'commander';
import { ShadowClient } from '../client/api-client';
import { resolveServerURL } from '../config/config';

export function registerReplayCommand(program: Command): void {
  program
    .command('replay')
    .description('Replay an execution by reconstructing the required replay body from the stored execution record')
    .argument('<execution-id>', 'Execution id')
    .action(async (executionId: string) => {
      const serverURL = await resolveServerURL({
        flagValue: program.opts<{ server?: string }>().server,
      });
      const client = new ShadowClient(serverURL);
      const execution = await client.getExecution(executionId);
      const result = await client.replayExecution(executionId, {
        promptHash: execution.promptHash,
        parameters: execution.parameters,
        inputArtifacts: execution.inputArtifacts,
        outputArtifacts: execution.outputArtifacts,
        status: execution.status,
      });

      console.log('Replay complete');
      console.log(`executionId: ${result.executionId}`);
      console.log(`verified: ${result.verified}`);
      console.log(`resultHash: ${result.resultHash}`);
    });
}
