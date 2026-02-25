import chalk from 'chalk';
import type {
  Action,
  ActionOutput,
  ActionsListOutput,
  Contact,
  ContactInteraction,
  Deal,
  Pipeline,
  PipelineStage,
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

// ─── Contact output ────────────────────────────────────────

export function outputContactJson(contact: Contact): void {
  console.log(JSON.stringify(transformContact(contact), null, 2));
}

export function outputContactPretty(contact: Contact): void {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || chalk.gray('(no name)');
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${chalk.bold(name)}`);
  console.log(chalk.gray(`  ID: ${contact.id}`));
  if (contact.email) console.log(`  ${chalk.cyan('Email:')} ${contact.email}`);
  if (contact.phone) console.log(`  ${chalk.cyan('Phone:')} ${contact.phone}`);
  if (contact.telegram) console.log(`  ${chalk.cyan('Telegram:')} ${contact.telegram}`);
  if (contact.linkedIn) console.log(`  ${chalk.cyan('LinkedIn:')} ${contact.linkedIn}`);
  if (contact.twitter) console.log(`  ${chalk.cyan('Twitter:')} ${contact.twitter}`);
  if (contact.github) console.log(`  ${chalk.cyan('GitHub:')} ${contact.github}`);
  if (contact.bluesky) console.log(`  ${chalk.cyan('Bluesky:')} ${contact.bluesky}`);
  if (contact.about) console.log(`  ${chalk.gray('About:')} ${contact.about.substring(0, 120)}${contact.about.length > 120 ? '...' : ''}`);
  if (contact.profileType) console.log(`  ${chalk.magenta('Type:')} ${contact.profileType}`);
  if (contact.skills?.length) console.log(`  ${chalk.yellow('Skills:')} ${contact.skills.join(', ')}`);
  if (contact.tags?.length) console.log(`  ${chalk.yellow('Tags:')} ${contact.tags.join(', ')}`);
  if (contact.organization) console.log(`  ${chalk.green('Org:')} ${contact.organization.name}`);
  if (contact.connectionScore != null) console.log(`  ${chalk.blue('Connection Score:')} ${contact.connectionScore}`);
  if (contact.lastInteractionAt) console.log(`  ${chalk.gray('Last Interaction:')} ${formatDate(new Date(contact.lastInteractionAt))} (${contact.lastInteractionType ?? ''})`);
  console.log();
}

export function outputContactsJson(contacts: Contact[], nextCursor?: string): void {
  console.log(JSON.stringify({
    contacts: contacts.map(transformContact),
    total: contacts.length,
    nextCursor: nextCursor ?? null,
  }, null, 2));
}

export function outputContactsPretty(contacts: Contact[]): void {
  if (contacts.length === 0) {
    console.log(chalk.gray('No contacts found.'));
    return;
  }
  console.log(chalk.bold(`\nContacts (${contacts.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const contact of contacts) {
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || chalk.gray('(no name)');
    console.log(`\n${chalk.bold(name)}`);
    console.log(chalk.gray(`  ID: ${contact.id}`));
    if (contact.email) console.log(`  ${chalk.cyan('Email:')} ${contact.email}`);
    if (contact.organization) console.log(`  ${chalk.green('Org:')} ${contact.organization.name}`);
    if (contact.tags?.length) console.log(`  ${chalk.yellow('Tags:')} ${contact.tags.join(', ')}`);
  }
  console.log();
}

function transformContact(contact: Contact): Record<string, unknown> {
  return {
    id: contact.id,
    workspaceId: contact.workspaceId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    linkedIn: contact.linkedIn,
    telegram: contact.telegram,
    twitter: contact.twitter,
    github: contact.github,
    bluesky: contact.bluesky,
    about: contact.about,
    profileType: contact.profileType,
    skills: contact.skills,
    tags: contact.tags,
    organizationId: contact.organizationId,
    organization: contact.organization ?? null,
    connectionScore: contact.connectionScore,
    lastInteractionAt: contact.lastInteractionAt ? new Date(contact.lastInteractionAt).toISOString() : null,
    lastInteractionType: contact.lastInteractionType,
    createdAt: new Date(contact.createdAt).toISOString(),
    updatedAt: new Date(contact.updatedAt).toISOString(),
  };
}

// ─── Interaction output ────────────────────────────────────

export function outputInteractionJson(interaction: ContactInteraction): void {
  console.log(JSON.stringify(interaction, null, 2));
}

export function outputInteractionPretty(interaction: ContactInteraction): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  ${chalk.cyan('Type:')} ${interaction.type} (${interaction.direction})`);
  if (interaction.subject) console.log(`  ${chalk.bold('Subject:')} ${interaction.subject}`);
  if (interaction.notes) console.log(`  ${chalk.gray('Notes:')} ${interaction.notes}`);
  console.log();
}

// ─── Deal output ───────────────────────────────────────────

export function outputDealJson(deal: Deal): void {
  console.log(JSON.stringify(transformDeal(deal), null, 2));
}

export function outputDealPretty(deal: Deal): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${chalk.bold(deal.title)}`);
  console.log(chalk.gray(`  ID: ${deal.id}`));
  if (deal.stage) console.log(`  ${chalk.blue('Stage:')} ${deal.stage.name}`);
  if (deal.value != null) console.log(`  ${chalk.green('Value:')} ${deal.currency} ${deal.value.toLocaleString()}`);
  if (deal.probability != null) console.log(`  ${chalk.yellow('Probability:')} ${deal.probability}%`);
  if (deal.expectedCloseDate) console.log(`  ${chalk.cyan('Expected Close:')} ${formatDate(new Date(deal.expectedCloseDate))}`);
  if (deal.contact) {
    const name = [deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(' ');
    if (name) console.log(`  ${chalk.magenta('Contact:')} ${name}`);
  }
  if (deal.organization) console.log(`  ${chalk.magenta('Org:')} ${deal.organization.name}`);
  if (deal.assignedTo) console.log(`  ${chalk.gray('Assigned:')} ${deal.assignedTo.name ?? deal.assignedTo.email ?? deal.assignedTo.id}`);
  if (deal.description) console.log(`  ${chalk.gray('Description:')} ${deal.description.substring(0, 120)}${deal.description.length > 120 ? '...' : ''}`);
  console.log();
}

export function outputDealsJson(deals: Deal[]): void {
  console.log(JSON.stringify({
    deals: deals.map(transformDeal),
    total: deals.length,
  }, null, 2));
}

export function outputDealsPretty(deals: Deal[]): void {
  if (deals.length === 0) {
    console.log(chalk.gray('No deals found.'));
    return;
  }
  console.log(chalk.bold(`\nDeals (${deals.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const deal of deals) {
    const stageLabel = deal.stage ? chalk.blue(`[${deal.stage.name}]`) : '';
    const valueLabel = deal.value != null ? chalk.green(` ${deal.currency} ${deal.value.toLocaleString()}`) : '';
    console.log(`\n${stageLabel} ${chalk.bold(deal.title)}${valueLabel}`);
    console.log(chalk.gray(`  ID: ${deal.id}`));
    if (deal.contact) {
      const name = [deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(' ');
      if (name) console.log(`  ${chalk.magenta('Contact:')} ${name}`);
    }
    if (deal.probability != null) console.log(`  ${chalk.yellow('Probability:')} ${deal.probability}%`);
    if (deal.expectedCloseDate) console.log(`  ${chalk.cyan('Close:')} ${formatDate(new Date(deal.expectedCloseDate))}`);
  }
  console.log();
}

function transformDeal(deal: Deal): Record<string, unknown> {
  return {
    id: deal.id,
    projectId: deal.projectId,
    stageId: deal.stageId,
    title: deal.title,
    description: deal.description,
    value: deal.value,
    currency: deal.currency,
    probability: deal.probability,
    expectedCloseDate: deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString() : null,
    closedAt: deal.closedAt ? new Date(deal.closedAt).toISOString() : null,
    contactId: deal.contactId,
    organizationId: deal.organizationId,
    workspaceId: deal.workspaceId,
    assignedToId: deal.assignedToId,
    stage: deal.stage ? { id: deal.stage.id, name: deal.stage.name, color: deal.stage.color } : null,
    contact: deal.contact ?? null,
    organization: deal.organization ?? null,
    assignedTo: deal.assignedTo ?? null,
    createdAt: new Date(deal.createdAt).toISOString(),
    updatedAt: new Date(deal.updatedAt).toISOString(),
  };
}

// ─── Pipeline output ───────────────────────────────────────

export function outputPipelineJson(pipeline: Pipeline): void {
  console.log(JSON.stringify({
    id: pipeline.id,
    name: pipeline.name,
    workspaceId: pipeline.workspaceId,
    status: pipeline.status,
    stages: pipeline.pipelineStages.map(s => ({
      id: s.id,
      name: s.name,
      color: s.color,
      order: s.order,
      type: s.type,
      dealCount: s._count?.deals ?? null,
    })),
  }, null, 2));
}

export function outputPipelinePretty(pipeline: Pipeline): void {
  console.log(chalk.bold(`\nPipeline: ${pipeline.name}`));
  console.log(chalk.gray(`  ID: ${pipeline.id}`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const stage of pipeline.pipelineStages) {
    const count = stage._count?.deals != null ? chalk.gray(` (${stage._count.deals} deals)`) : '';
    console.log(`  ${chalk.bold(stage.name)}${count} — ${chalk.gray(stage.type)}`);
  }
  console.log();
}

export function outputStagesJson(stages: PipelineStage[]): void {
  console.log(JSON.stringify({
    stages: stages.map(s => ({
      id: s.id,
      name: s.name,
      color: s.color,
      order: s.order,
      type: s.type,
      dealCount: s._count?.deals ?? null,
    })),
    total: stages.length,
  }, null, 2));
}

export function outputStagesPretty(stages: PipelineStage[]): void {
  if (stages.length === 0) {
    console.log(chalk.gray('No stages found.'));
    return;
  }
  console.log(chalk.bold(`\nPipeline Stages (${stages.length})`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const stage of stages) {
    const count = stage._count?.deals != null ? chalk.gray(` (${stage._count.deals} deals)`) : '';
    console.log(`  ${chalk.bold(stage.name)}${count} — ${chalk.gray(stage.type)}`);
  }
  console.log();
}
