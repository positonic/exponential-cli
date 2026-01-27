// Action types matching the Exponential API responses

export type KanbanStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'DONE'
  | 'CANCELLED';

export type Priority =
  | 'Quick'
  | 'Scheduled'
  | '1st Priority'
  | '2nd Priority'
  | '3rd Priority'
  | '4th Priority'
  | '5th Priority'
  | 'Errand'
  | 'Remember'
  | 'Watch'
  | 'Someday Maybe';

export interface Action {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  projectId: string | null;
  workspaceId: string | null;
  kanbanStatus: KanbanStatus | null;
  kanbanOrder: number | null;
  dueDate: Date | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  duration: number | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  source: string;
  project?: {
    id: string;
    name: string;
  } | null;
  workspace?: {
    id: string;
    slug: string;
    name: string;
  } | null;
  assignees?: Array<{
    user: {
      id: string;
      name: string | null;
      email: string | null;
    };
  }>;
}

export interface ActionOutput {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  kanbanStatus: string | null;
  dueDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  project: {
    id: string;
    name: string;
  } | null;
  workspace: {
    id: string;
    slug: string;
    name: string;
  } | null;
  assignees: Array<{
    id: string;
    name: string | null;
    email: string | null;
  }>;
  createdAt: string;
  completedAt: string | null;
}

export interface ActionsListOutput {
  actions: ActionOutput[];
  total: number;
  filters: {
    status?: string;
    projectId?: string;
    workspaceId?: string;
    kanbanStatus?: string;
  };
}
