export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_CLIENT_ERROR = 1;
export const EXIT_CODE_SERVER_ERROR = 2;
export const EXIT_CODE_NETWORK_ERROR = 3;

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = EXIT_CODE_CLIENT_ERROR) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export function getExitCode(error: unknown): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }

  return 1;
}

export function toErrorMessage(error: unknown): string {
  const prefix = 'Error: ';

  if (error instanceof Error) {
    return error.message.startsWith(prefix) ? error.message : `${prefix}${error.message}`;
  }

  return `${prefix}Unknown error`;
}
