import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import superjson from 'superjson';
import { getConfig, isAuthenticated } from '../config/index.js';

// We create a minimal type definition that matches the server's AppRouter
// This avoids tight coupling while still providing type hints

type ActionInput = {
  assigneeId?: string;
};

type KanbanInput = {
  projectId?: string;
  assigneeId?: string;
  kanbanStatus?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'CANCELLED';
};

type TodayInput = {
  workspaceId?: string;
};

type DateRangeInput = {
  startDate: Date;
  endDate: Date;
  workspaceId?: string;
};

type ProjectInput = {
  include?: {
    actions?: boolean;
  };
  workspaceId?: string;
};

// Define a minimal router type for the procedures we use
interface AppRouter {
  action: {
    getAll: { query: (input?: ActionInput) => Promise<unknown[]> };
    getKanbanActions: { query: (input?: KanbanInput) => Promise<unknown[]> };
    getToday: { query: (input?: TodayInput) => Promise<unknown[]> };
    getByDateRange: { query: (input: DateRangeInput) => Promise<unknown[]> };
    getProjectActions: { query: (input: { projectId: string; assigneeId?: string }) => Promise<unknown[]> };
  };
  project: {
    getAll: { query: (input?: ProjectInput) => Promise<unknown[]> };
  };
  workspace: {
    list: { query: () => Promise<unknown[]> };
  };
}

let clientInstance: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;

export function getClient() {
  if (!isAuthenticated()) {
    throw new Error('Not authenticated. Run: exponential auth login --token <your-jwt> --api-url <url>');
  }

  if (clientInstance) {
    return clientInstance;
  }

  const config = getConfig();

  clientInstance = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${config.apiUrl}/api/trpc`,
        headers() {
          return {
            Authorization: `Bearer ${config.token}`,
          };
        },
        transformer: superjson,
      }),
    ],
  });

  return clientInstance;
}

export function resetClient() {
  clientInstance = null;
}

export function isTRPCError(error: unknown): error is TRPCClientError<AppRouter> {
  return error instanceof TRPCClientError;
}

export { TRPCClientError };
