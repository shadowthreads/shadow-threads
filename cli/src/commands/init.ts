import type { Command } from 'commander';
import { initializeConfig } from '../config/config';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create .shadow and shadow.config.json in the current directory')
    .action(async () => {
      const result = await initializeConfig();

      console.log('Shadow workspace initialized');
      console.log(`config: ${result.configPath}`);
      console.log(`workspace: ${result.workspacePath}`);

      if (!result.configCreated) {
        console.log('configStatus: existing');
      }

      if (!result.workspaceCreated) {
        console.log('workspaceStatus: existing');
      }
    });
}
