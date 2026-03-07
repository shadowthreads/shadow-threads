import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { CliError } from '../utils/errors';
import { ensureDirectory, readJsonFile, writeJsonFile } from '../utils/fs';

export const CONFIG_FILE_NAME = 'shadow.config.json';

export const defaultConfig = {
  server: 'http://localhost:3000',
  workspace: '.shadow',
} as const;

const shadowConfigSchema = z.object({
  server: z.string().min(1).default(defaultConfig.server),
  workspace: z.string().min(1).default(defaultConfig.workspace),
});

export type ShadowConfig = z.infer<typeof shadowConfigSchema>;

export type LoadedConfig = {
  config: ShadowConfig;
  configPath: string;
  workspacePath: string;
};

export type InitializedConfig = LoadedConfig & {
  configCreated: boolean;
  workspaceCreated: boolean;
};

export function resolveConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, CONFIG_FILE_NAME);
}

function normalizeOptionalString(value: string | undefined | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadConfigIfPresent(cwd = process.cwd()): Promise<LoadedConfig | null> {
  const configPath = resolveConfigPath(cwd);
  if (!existsSync(configPath)) {
    return null;
  }

  const raw = await readJsonFile(configPath);
  const parsed = shadowConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CliError(`Invalid ${CONFIG_FILE_NAME}: ${parsed.error.message}`);
  }

  return {
    config: parsed.data,
    configPath,
    workspacePath: path.resolve(cwd, parsed.data.workspace),
  };
}

export async function loadConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  const loaded = await loadConfigIfPresent(cwd);
  if (!loaded) {
    throw new CliError(`Missing ${CONFIG_FILE_NAME} in ${cwd}. Run "shadow init" first.`);
  }

  return loaded;
}

export async function resolveServerURL(options?: { flagValue?: string; cwd?: string }): Promise<string> {
  const cwd = options?.cwd ?? process.cwd();
  const fromFlag = normalizeOptionalString(options?.flagValue);
  if (fromFlag) {
    return fromFlag;
  }

  const fromEnv = normalizeOptionalString(process.env.SHADOW_SERVER);
  if (fromEnv) {
    return fromEnv;
  }

  const loaded = await loadConfigIfPresent(cwd);
  if (loaded) {
    return loaded.config.server;
  }

  return defaultConfig.server;
}

export async function initializeConfig(cwd = process.cwd()): Promise<InitializedConfig> {
  const configPath = resolveConfigPath(cwd);
  let configCreated = false;
  let loaded: LoadedConfig;

  if (existsSync(configPath)) {
    loaded = await loadConfig(cwd);
  } else {
    await writeJsonFile(configPath, defaultConfig);
    configCreated = true;
    loaded = {
      config: defaultConfig,
      configPath,
      workspacePath: path.resolve(cwd, defaultConfig.workspace),
    };
  }

  const workspaceAlreadyExists = existsSync(loaded.workspacePath);
  await ensureDirectory(loaded.workspacePath);

  return {
    ...loaded,
    configCreated,
    workspaceCreated: !workspaceAlreadyExists,
  };
}
