export interface Workspace {
  id: string;
  name: string;
  slug: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceOutput {
  id: string;
  name: string;
  slug: string;
  type: string;
}

export interface WorkspacesListOutput {
  workspaces: WorkspaceOutput[];
  total: number;
}
