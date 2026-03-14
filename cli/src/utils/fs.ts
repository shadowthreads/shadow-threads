import path from 'node:path';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { CliError } from './errors';

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const contents = await readFile(filePath, 'utf8');
    return JSON.parse(contents) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliError(`Invalid JSON in ${filePath}`);
    }

    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new CliError(`File not found: ${filePath}`);
    }

    if (error instanceof ZodError) {
      throw new CliError(error.message);
    }

    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, text, 'utf8');
}

export async function copyFileTo(sourcePath: string, destinationPath: string): Promise<void> {
  if (!existsSync(sourcePath)) {
    throw new CliError(
      `Server returned zipPath "${sourcePath}", but it is not accessible locally. This command only works when the CLI can access the server filesystem.`,
    );
  }

  await ensureDirectory(path.dirname(destinationPath));
  await copyFile(sourcePath, destinationPath);
}
