import chalk from 'chalk';
import { isTRPCError } from '../client/trpc.js';

export class ExponentialError extends Error {
  constructor(
    message: string,
    public code: string,
    public suggestion?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ExponentialError';
  }
}

export function handleError(error: unknown, json: boolean = false): never {
  if (error instanceof ExponentialError) {
    if (json) {
      console.log(JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
          suggestion: error.suggestion,
        },
      }, null, 2));
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
      if (error.suggestion) {
        console.error(chalk.yellow(`Suggestion: ${error.suggestion}`));
      }
    }
    process.exit(1);
  }

  if (isTRPCError(error)) {
    const code = error.data?.code ?? 'UNKNOWN';
    let message = error.message;
    let suggestion: string | undefined;

    switch (code) {
      case 'UNAUTHORIZED':
        message = 'Authentication failed. Your token may have expired.';
        suggestion = 'Run: exponential auth login --token <new-token> --api-url <url>';
        break;
      case 'NOT_FOUND':
        message = 'Resource not found';
        break;
      case 'FORBIDDEN':
        message = 'Access denied';
        break;
    }

    if (json) {
      console.log(JSON.stringify({
        error: {
          code,
          message,
          suggestion,
        },
      }, null, 2));
    } else {
      console.error(chalk.red(`Error [${code}]: ${message}`));
      if (suggestion) {
        console.error(chalk.yellow(`Suggestion: ${suggestion}`));
      }
    }
    process.exit(1);
  }

  // Generic error handling
  if (json) {
    console.log(JSON.stringify({
      error: {
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      },
    }, null, 2));
  } else {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  }
  process.exit(1);
}
