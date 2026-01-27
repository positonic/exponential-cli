import Conf from 'conf';

export interface ExponentialConfig {
  apiUrl: string;
  token: string;
  tokenExpiry?: string;
  defaultWorkspaceId?: string;
  defaultWorkspaceSlug?: string;
}

const schema = {
  apiUrl: {
    type: 'string' as const,
    default: '',
  },
  token: {
    type: 'string' as const,
    default: '',
  },
  tokenExpiry: {
    type: 'string' as const,
    default: '',
  },
  defaultWorkspaceId: {
    type: 'string' as const,
    default: '',
  },
  defaultWorkspaceSlug: {
    type: 'string' as const,
    default: '',
  },
};

const config = new Conf<ExponentialConfig>({
  projectName: 'exponential-cli',
  schema,
});

export function getConfig(): ExponentialConfig {
  return {
    apiUrl: config.get('apiUrl'),
    token: config.get('token'),
    tokenExpiry: config.get('tokenExpiry'),
    defaultWorkspaceId: config.get('defaultWorkspaceId'),
    defaultWorkspaceSlug: config.get('defaultWorkspaceSlug'),
  };
}

export function setConfig(values: Partial<ExponentialConfig>): void {
  if (values.apiUrl !== undefined) config.set('apiUrl', values.apiUrl);
  if (values.token !== undefined) config.set('token', values.token);
  if (values.tokenExpiry !== undefined) config.set('tokenExpiry', values.tokenExpiry);
  if (values.defaultWorkspaceId !== undefined) config.set('defaultWorkspaceId', values.defaultWorkspaceId);
  if (values.defaultWorkspaceSlug !== undefined) config.set('defaultWorkspaceSlug', values.defaultWorkspaceSlug);
}

export function clearConfig(): void {
  config.clear();
}

export function isAuthenticated(): boolean {
  const cfg = getConfig();
  return Boolean(cfg.token && cfg.apiUrl);
}

export function getConfigPath(): string {
  return config.path;
}
