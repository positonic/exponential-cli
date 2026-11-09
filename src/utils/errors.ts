import chalk from 'chalk';
import { isTRPCError } from '../client/index.js';

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
        // The server says what was not found ("Page not found"); keep it.
        message = message || 'Resource not found';
        break;
      case 'FORBIDDEN':
        // The server's message names the account that was refused, the
        // project and the missing access — exactly what the person holding
        // the token needs. A bare "Access denied" hid all of that.
        message = message || 'Access denied';
        suggestion = 'Run `exponential auth whoami` to see which account this token is; that is the account to grant access to.';
        break;
    }

    // A database write refused by the property registry names the property
    // (ADR-0078); pass it through so a caller can point at the cell.
    const property = (error.data as { property?: unknown } | undefined)?.property;
    if (json) {
      console.log(JSON.stringify({
        error: {
          code,
          message,
          suggestion,
          ...(property ? { property } : {}),
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
