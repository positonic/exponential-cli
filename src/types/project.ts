export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  workspace?: {
    id: string;
    slug: string;
    name: string;
  } | null;
}

export interface ProjectOutput {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  workspace: {
    id: string;
    slug: string;
    name: string;
  } | null;
}

export interface ProjectsListOutput {
  projects: ProjectOutput[];
  total: number;
}
