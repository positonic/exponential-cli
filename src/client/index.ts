import { ExponentialClient } from 'exponential-sdk';
import { getConfig, isAuthenticated } from '../config/index.js';

let clientInstance: ExponentialClient | null = null;

export function getClient() {
  if (!isAuthenticated()) {
    throw new Error('Not authenticated. Run: exponential auth login --token <your-jwt> --api-url <url>');
  }

  if (clientInstance) {
    return clientInstance;
  }

  const config = getConfig();
  clientInstance = new ExponentialClient({
    token: config.token,
    apiUrl: config.apiUrl,
  });

  return clientInstance;
}

export function resetClient() {
  clientInstance = null;
}

export { isTRPCError, TRPCClientError } from 'exponential-sdk';
