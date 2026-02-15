import { createConfigStore } from 'exponential-sdk';
import type { ExponentialConfig } from 'exponential-sdk';

const configStore = createConfigStore({ projectName: 'exponential-cli' });

export type { ExponentialConfig };

export function getConfig(): ExponentialConfig {
  return configStore.loadConfig();
}

export function setConfig(values: Partial<ExponentialConfig>): void {
  configStore.saveConfig(values);
}

export function clearConfig(): void {
  configStore.clearConfig();
}

export function isAuthenticated(): boolean {
  return configStore.isAuthenticated();
}

export function getConfigPath(): string {
  return configStore.getConfigPath();
}
