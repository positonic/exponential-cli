import chalk from 'chalk';
import type {
  Action,
  ActionOutput,
  ActionsListOutput,
  Project,
  ProjectOutput,
  ProjectsListOutput,
  Workspace,
  WorkspaceOutput,
  WorkspacesListOutput,
} from 'exponential-sdk';

// Detect if output is being piped
export function shouldUseJson(forceJson?: boolean, forcePretty?: boolean): boolean {
  if (forceJson) return true;
  if (forcePretty) return false;
  return !process.stdout.isTTY;
}

// Transform Action to ActionOutput (serialize dates)
export function transformAction(action: Action): ActionOutput {
  return {
    id: action.id,
    name: action.name,
    description: action.description,
    status: action.status,
    priority: action.priority,
    kanbanStatus: action.kanbanStatus,
    dueDate: action.dueDate?.toISOString() ?? null,
    scheduledStart: action.scheduledStart?.toISOString() ?? null,
    scheduledEnd: action.scheduledEnd?.toISOString() ?? null,
    project: action.project ? {
      id: action.project.id,
      name: action.project.name,
    } : null,
    workspace: action.workspace ? {
      id: action.workspace.id,
      slug: action.workspace.slug,
      name: action.workspace.name,
    } : null,
    assignees: action.assignees?.map(a => ({
      id: a.user.id,
      name: a.user.name,
      email: a.user.email,
    })) ?? [],
    createdAt: action.createdAt?.toISOString() ?? new Date().toISOString(),
    completedAt: action.completedAt?.toISOString() ?? null,
  };
}

// Transform Project to ProjectOutput
export function transformProject(project: Project): ProjectOutput {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    workspace: project.workspace ? {
      id: project.workspace.id,
      slug: project.workspace.slug,
      name: project.workspace.name,
    } : null,
  };
}

// Transform Workspace to WorkspaceOutput
export function transformWorkspace(workspace: Workspace): WorkspaceOutput {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    type: workspace.type,
  };
}

// Output single action as JSON
export function outputActionJson(action: Action): void {
  const output = transformAction(action);
  console.log(JSON.stringify(output, null, 2));
}

// Output single action in pretty format
export function outputActionPretty(action: Action): void {
  const statusColor = getKanbanStatusColor(action.kanbanStatus);
  const statusBadge = action.kanbanStatus
    ? chalk[statusColor](`[${action.kanbanStatus}]`)
    : chalk.gray('[NO STATUS]');

  console.log(chalk.green('\n✓ Action created successfully'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${statusBadge} ${chalk.bold(action.name)}`);
  console.log(chalk.gray(`  ID: ${action.id}`));

  if (action.project) {
    console.log(`  ${chalk.cyan('Project:')} ${action.project.name}`);
  }

  console.log(`  ${chalk.magenta('Priority:')} ${action.priority}`);

  if (action.dueDate) {
    const dueDate = new Date(action.dueDate);
    console.log(`  ${chalk.yellow('Due:')} ${formatDate(dueDate)}`);
  }

  if (action.description) {
    console.log(`  ${chalk.gray('Description:')} ${action.description.substring(0, 100)}${action.description.length > 100 ? '...' : ''}`);
  }
  console.log();
}

// Output actions as JSON
export function outputActionsJson(actions: Action[], filters: ActionsListOutput['filters'] = {}): void {
  const output: ActionsListOutput = {
    actions: actions.map(transformAction),
    total: actions.length,
    filters,
  };
  console.log(JSON.stringify(output, null, 2));
}

// Output actions in pretty format
export function outputActionsPretty(actions: Action[]): void {
  if (actions.length === 0) {
    console.log(chalk.gray('No actions found.'));
    return;
  }

  console.log(chalk.bold(`\nActions (${actions.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));

  for (const action of actions) {
    const statusColor = getKanbanStatusColor(action.kanbanStatus);
    const statusBadge = action.kanbanStatus
      ? chalk[statusColor](`[${action.kanbanStatus}]`)
      : chalk.gray('[NO STATUS]');

    console.log(`\n${statusBadge} ${chalk.bold(action.name)}`);
    console.log(chalk.gray(`  ID: ${action.id}`));

    if (action.project) {
      console.log(`  ${chalk.cyan('Project:')} ${action.project.name}`);
    }

    console.log(`  ${chalk.magenta('Priority:')} ${action.priority}`);

    if (action.dueDate) {
      const dueDate = new Date(action.dueDate);
      const isOverdue = dueDate < new Date();
      const dateStr = formatDate(dueDate);
      console.log(`  ${chalk.yellow('Due:')} ${isOverdue ? chalk.red(dateStr) : dateStr}`);
    }

    if (action.description) {
      console.log(`  ${chalk.gray('Description:')} ${action.description.substring(0, 100)}${action.description.length > 100 ? '...' : ''}`);
    }
  }
  console.log();
}

// Output projects as JSON
export function outputProjectsJson(projects: Project[]): void {
  const output: ProjectsListOutput = {
    projects: projects.map(transformProject),
    total: projects.length,
  };
  console.log(JSON.stringify(output, null, 2));
}

// Output projects in pretty format
export function outputProjectsPretty(projects: Project[]): void {
  if (projects.length === 0) {
    console.log(chalk.gray('No projects found.'));
    return;
  }

  console.log(chalk.bold(`\nProjects (${projects.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));

  for (const project of projects) {
    console.log(`\n${chalk.bold(project.name)}`);
    console.log(chalk.gray(`  ID: ${project.id}`));

    if (project.status) {
      console.log(`  ${chalk.cyan('Status:')} ${project.status}`);
    }

    if (project.priority) {
      console.log(`  ${chalk.magenta('Priority:')} ${project.priority}`);
    }

    if (project.workspace) {
      console.log(`  ${chalk.yellow('Workspace:')} ${project.workspace.name} (${project.workspace.slug})`);
    }

    if (project.description) {
      console.log(`  ${chalk.gray('Description:')} ${project.description.substring(0, 100)}${project.description.length > 100 ? '...' : ''}`);
    }
  }
  console.log();
}

// Output workspaces as JSON
export function outputWorkspacesJson(workspaces: Workspace[]): void {
  const output: WorkspacesListOutput = {
    workspaces: workspaces.map(transformWorkspace),
    total: workspaces.length,
  };
  console.log(JSON.stringify(output, null, 2));
}

// Output workspaces in pretty format
export function outputWorkspacesPretty(workspaces: Workspace[]): void {
  if (workspaces.length === 0) {
    console.log(chalk.gray('No workspaces found.'));
    return;
  }

  console.log(chalk.bold(`\nWorkspaces (${workspaces.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));

  for (const workspace of workspaces) {
    console.log(`\n${chalk.bold(workspace.name)}`);
    console.log(chalk.gray(`  ID: ${workspace.id}`));
    console.log(`  ${chalk.cyan('Slug:')} ${workspace.slug}`);
    console.log(`  ${chalk.magenta('Type:')} ${workspace.type}`);
  }
  console.log();
}

// Helper functions
function getKanbanStatusColor(status: string | null): 'gray' | 'blue' | 'yellow' | 'cyan' | 'green' | 'red' {
  switch (status) {
    case 'BACKLOG': return 'gray';
    case 'TODO': return 'blue';
    case 'IN_PROGRESS': return 'yellow';
    case 'IN_REVIEW': return 'cyan';
    case 'DONE': return 'green';
    case 'CANCELLED': return 'red';
    default: return 'gray';
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
