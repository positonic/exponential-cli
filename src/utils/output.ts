import chalk from 'chalk';
import type {
  Action,
  ActionComment,
  ActionOutput,
  ActionsListOutput,
  Contact,
  ContactInteraction,
  Deal,
  Epic,
  Feature,
  FeatureScope,
  Goal,
  GoalPeriod,
  GoalStats,
  GoalTreeNode,
  KeyResult,
  KeyResultCheckIn,
  KnowledgePage,
  ObjectiveWithKeyResults,
  Organization,
  OverdueTriage,
  Pipeline,
  PipelineStage,
  Product,
  Project,
  ProjectOutput,
  ProjectsListOutput,
  Requirement,
  Ticket,
  TodaysActions,
  TicketComment,
  GoalComment,
  FeatureComment,
  PageComment,
  TicketDetail,
  UserStory,
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

// ─── Today's actions (the /today partition) ────────────────

export function outputTodaysActionsJson(t: TodaysActions, filters: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    overdue: { count: t.overdue.count, actions: t.overdue.actions },
    today: { count: t.today.count, actions: t.today.actions },
    inbox: { count: t.inbox.count, actions: t.inbox.actions },
    total: t.overdue.count + t.today.count + t.inbox.count,
    filters,
  }, null, 2));
}

function printTodayGroup(label: string, group: TodaysActions['overdue'], color: 'red' | 'green' | 'gray'): void {
  if (group.count === 0) return;
  const truncated = group.count > group.actions.length
    ? chalk.gray(` (showing ${group.actions.length})`)
    : '';
  console.log(`\n${chalk[color].bold(`${label} (${group.count})`)}${truncated}`);
  for (const a of group.actions) {
    const when = a.scheduledStart ?? a.dueDate;
    const stamp = when ? chalk.gray(formatDate(new Date(when))) : '';
    const project = a.projectName ? chalk.cyan(` [${a.projectName}]`) : '';
    console.log(`  ${a.name}${project} ${stamp}`);
    console.log(chalk.gray(`    ID: ${a.id}`));
  }
}

export function outputTodaysActionsPretty(t: TodaysActions): void {
  const total = t.overdue.count + t.today.count + t.inbox.count;
  if (total === 0) {
    console.log(chalk.gray('Nothing on your plate.'));
    return;
  }
  console.log(chalk.bold('\nOn your plate'));
  console.log(chalk.gray('─'.repeat(50)));
  printTodayGroup('Overdue', t.overdue, 'red');
  printTodayGroup('Today', t.today, 'green');
  printTodayGroup('Inbox', t.inbox, 'gray');
  if (t.overdue.count > 0) {
    console.log(chalk.gray(`\nRun "exponential actions overdue" to see why the overdue pile is that size.`));
  }
  console.log();
}

// ─── Overdue triage ────────────────────────────────────────

export function outputOverdueTriageJson(t: OverdueTriage): void {
  console.log(JSON.stringify(t, null, 2));
}

export function outputOverdueTriagePretty(t: OverdueTriage): void {
  if (t.totalOverdue === 0) {
    console.log(chalk.green('Nothing overdue.'));
    return;
  }

  console.log(chalk.bold(`\nOverdue: ${t.totalOverdue}`));
  console.log(chalk.gray('─'.repeat(50)));

  if (t.cohorts.length > 0) {
    console.log(
      `\n${chalk.yellow.bold(`${t.cohortCount} of these were bulk-created`)} ${chalk.gray('— stamped with one identical timestamp, so almost certainly never individually due.')}`,
    );
    for (const c of t.cohorts) {
      console.log(
        `\n  ${chalk.bold(`${c.count} actions`)} stamped ${chalk.gray(c.stampedAt.toISOString())} ${chalk.red(`(${c.daysOverdue}d overdue)`)}`,
      );
      if (c.projectNames.length > 0) {
        console.log(`    ${chalk.cyan('Projects:')} ${c.projectNames.join(', ')}`);
      }
      for (const a of c.actions.slice(0, 4)) {
        console.log(chalk.gray(`      · ${a.name.substring(0, 62)}`));
      }
      if (c.actions.length > 4) {
        console.log(chalk.gray(`      · … and ${c.actions.length - 4} more`));
      }
      console.log(
        chalk.gray(`    Amnesty: `) +
          `exponential actions defer --ids ${c.actionIds.slice(0, 2).join(',')}${c.actionIds.length > 2 ? ',…' : ''}`,
      );
    }
  }

  if (t.loose.length > 0) {
    console.log(`\n${chalk.bold(`${t.loose.length} individually dated`)} ${chalk.gray('— real debt, oldest first.')}`);
    for (const a of t.loose) {
      const project = a.projectName ? chalk.cyan(` [${a.projectName}]`) : '';
      console.log(`  ${chalk.red(`${String(a.daysOverdue).padStart(3)}d`)}  ${a.name.substring(0, 62)}${project}`);
      console.log(chalk.gray(`        ID: ${a.id}`));
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

// ─── Organization output ───────────────────────────────────

function transformOrganization(org: Organization): Record<string, unknown> {
  return {
    id: org.id,
    workspaceId: org.workspaceId,
    name: org.name,
    websiteUrl: org.websiteUrl,
    logoUrl: org.logoUrl,
    description: org.description,
    industry: org.industry,
    size: org.size,
    contactCount: org._count?.contacts ?? null,
    createdAt: new Date(org.createdAt).toISOString(),
    updatedAt: new Date(org.updatedAt).toISOString(),
  };
}

export function outputOrganizationJson(org: Organization): void {
  console.log(JSON.stringify(transformOrganization(org), null, 2));
}

export function outputOrganizationPretty(org: Organization): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${chalk.bold(org.name)}`);
  console.log(chalk.gray(`  ID: ${org.id}`));
  if (org.industry) console.log(`  ${chalk.magenta('Industry:')} ${org.industry}`);
  if (org.size) console.log(`  ${chalk.cyan('Size:')} ${org.size}`);
  if (org.websiteUrl) console.log(`  ${chalk.cyan('Website:')} ${org.websiteUrl}`);
  if (org.description) console.log(`  ${chalk.gray('About:')} ${org.description.substring(0, 120)}${org.description.length > 120 ? '...' : ''}`);
  if (org._count?.contacts != null) console.log(`  ${chalk.green('Contacts:')} ${org._count.contacts}`);
  console.log();
}

export function outputOrganizationsJson(organizations: Organization[], nextCursor?: string): void {
  console.log(JSON.stringify({
    organizations: organizations.map(transformOrganization),
    total: organizations.length,
    nextCursor: nextCursor ?? null,
  }, null, 2));
}

export function outputOrganizationsPretty(organizations: Organization[]): void {
  if (organizations.length === 0) {
    console.log(chalk.gray('No organizations found.'));
    return;
  }
  console.log(chalk.bold(`\nOrganizations (${organizations.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const org of organizations) {
    console.log(`\n${chalk.bold(org.name)}`);
    console.log(chalk.gray(`  ID: ${org.id}`));
    if (org.industry) console.log(`  ${chalk.magenta('Industry:')} ${org.industry}`);
    if (org._count?.contacts != null) console.log(`  ${chalk.green('Contacts:')} ${org._count.contacts}`);
  }
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

// ─── Comment output ────────────────────────────────────────

// Two comment shapes exist server-side and both reach the CLI: actions,
// tickets and goals use `{ authorId, content, author }`; features and pages use
// `{ createdById, body, createdBy }`. Rather than teach every caller which is
// which, normalize once here — output is identical either way.
type AnyComment =
  | ActionComment
  | TicketComment
  | GoalComment
  | FeatureComment
  | PageComment;

const COMMENT_PARENT_KEYS = ['actionId', 'ticketId', 'goalId', 'featureId', 'pageId'] as const;

interface NormalizedComment {
  id: string;
  parentKey: string;
  parentId: unknown;
  authorId: string;
  author: { id: string; name: string | null } | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  /** Feature comments only: set when the comment is a reply. */
  parentCommentId?: string | null;
  /** Feature comments only: the anchored thread, when there is one. */
  threadId?: string | null;
  resolvedAt?: Date | null;
}

function normalizeComment(comment: AnyComment): NormalizedComment {
  const raw = comment as unknown as Record<string, unknown>;
  const parentKey = COMMENT_PARENT_KEYS.find((k) => k in raw) ?? 'parentId';
  const author = (raw.author ?? raw.createdBy ?? null) as
    | { id: string; name: string | null }
    | null;

  return {
    id: comment.id,
    parentKey,
    parentId: raw[parentKey],
    authorId: (raw.authorId ?? raw.createdById) as string,
    author,
    content: (raw.content ?? raw.body ?? '') as string,
    createdAt: new Date(comment.createdAt),
    updatedAt: new Date(comment.updatedAt),
    parentCommentId: (raw.parentId ?? null) as string | null,
    threadId: (raw.threadId ?? null) as string | null,
    resolvedAt: raw.resolvedAt ? new Date(raw.resolvedAt as string) : null,
  };
}

function transformComment(comment: AnyComment): Record<string, unknown> {
  const n = normalizeComment(comment);
  const out: Record<string, unknown> = {
    id: n.id,
    [n.parentKey]: n.parentId,
    authorId: n.authorId,
    content: n.content,
    author: n.author,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
  // Threading metadata only exists on feature comments — omit it elsewhere so
  // the JSON of an action comment stays exactly as it was.
  if (n.threadId !== null) out.threadId = n.threadId;
  if (n.parentCommentId !== null && n.parentKey !== 'parentId') {
    out.parentCommentId = n.parentCommentId;
  }
  if (n.resolvedAt) out.resolvedAt = n.resolvedAt.toISOString();
  return out;
}

export function outputCommentJson(comment: AnyComment): void {
  console.log(JSON.stringify(transformComment(comment), null, 2));
}

export function outputCommentPretty(comment: AnyComment): void {
  const n = normalizeComment(comment);
  const author = n.author?.name ?? n.authorId;
  const when = formatDate(n.createdAt);
  const badges = [
    n.parentCommentId && n.parentKey !== 'parentId' ? chalk.gray('(reply)') : '',
    n.resolvedAt ? chalk.green('(resolved)') : '',
  ]
    .filter(Boolean)
    .join(' ');
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`${chalk.bold(author)} ${chalk.gray(`— ${when}`)}${badges ? ` ${badges}` : ''}`);
  console.log(chalk.gray(`  ID: ${n.id}`));
  console.log();
  console.log(n.content);
  console.log();
}

export function outputCommentsJson(comments: AnyComment[]): void {
  console.log(JSON.stringify({
    comments: comments.map(transformComment),
    total: comments.length,
  }, null, 2));
}

export function outputCommentsPretty(comments: AnyComment[]): void {
  if (comments.length === 0) {
    console.log(chalk.gray('No comments.'));
    return;
  }
  console.log(chalk.bold(`\nComments (${comments.length})`));
  for (const c of comments) {
    outputCommentPretty(c);
  }
}

// ─── Product output ────────────────────────────────────────

export function outputProductJson(product: Product): void {
  console.log(JSON.stringify(transformProduct(product), null, 2));
}

export function outputProductPretty(product: Product): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${chalk.bold(product.name)} ${chalk.gray(`(${product.slug})`)}`);
  console.log(chalk.gray(`  ID: ${product.id}`));
  if (product.description) {
    console.log(`  ${chalk.gray('Description:')} ${product.description}`);
  }
  if (product._count) {
    const c = product._count;
    const parts = [
      c.features != null ? `features: ${c.features}` : null,
      c.tickets != null ? `tickets: ${c.tickets}` : null,
    ].filter(Boolean);
    if (parts.length) console.log(`  ${chalk.cyan('Counts:')} ${parts.join('  ')}`);
  }
  console.log();
}

export function outputProductsJson(products: Product[]): void {
  console.log(JSON.stringify({
    products: products.map(transformProduct),
    total: products.length,
  }, null, 2));
}

export function outputProductsPretty(products: Product[]): void {
  if (products.length === 0) {
    console.log(chalk.gray('No products found.'));
    return;
  }
  console.log(chalk.bold(`\nProducts (${products.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const p of products) {
    const ticketCount = p._count?.tickets != null ? chalk.gray(` — ${p._count.tickets} tickets`) : '';
    console.log(`  ${chalk.bold(p.name)} ${chalk.gray(`(${p.slug})`)}${ticketCount}`);
    console.log(chalk.gray(`    ID: ${p.id}`));
  }
  console.log();
}

function transformProduct(product: Product): Record<string, unknown> {
  return {
    id: product.id,
    workspaceId: product.workspaceId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    icon: product.icon,
    color: product.color,
    funTicketIds: product.funTicketIds,
    ticketCounter: product.ticketCounter,
    counts: product._count ?? null,
    createdAt: new Date(product.createdAt).toISOString(),
    updatedAt: new Date(product.updatedAt).toISOString(),
  };
}

// ─── Feature output ────────────────────────────────────────

export function outputFeatureJson(feature: Feature): void {
  console.log(JSON.stringify(transformFeature(feature), null, 2));
}

export function outputFeaturePretty(feature: Feature): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${chalk[getFeatureStatusColor(feature.status)](`[${feature.status}]`)} ${chalk.bold(feature.name)}`);
  console.log(chalk.gray(`  ID: ${feature.id}`));
  if (feature.description) {
    console.log(`  ${chalk.gray('Description:')} ${feature.description.substring(0, 120)}${feature.description.length > 120 ? '...' : ''}`);
  }
  if (feature.vision) {
    console.log(`  ${chalk.gray('Vision:')} ${feature.vision.substring(0, 120)}${feature.vision.length > 120 ? '...' : ''}`);
  }
  if (feature.priority != null) {
    console.log(`  ${chalk.magenta('Priority:')} ${feature.priority}`);
  }
  if (feature._count?.tickets != null) {
    console.log(`  ${chalk.cyan('Tickets:')} ${feature._count.tickets}`);
  }
  console.log();
}

export function outputFeaturesJson(features: Feature[]): void {
  console.log(JSON.stringify({
    features: features.map(transformFeature),
    total: features.length,
  }, null, 2));
}

export function outputFeaturesPretty(features: Feature[]): void {
  if (features.length === 0) {
    console.log(chalk.gray('No features found.'));
    return;
  }
  console.log(chalk.bold(`\nFeatures (${features.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const f of features) {
    const statusBadge = chalk[getFeatureStatusColor(f.status)](`[${f.status}]`);
    const ticketCount = f._count?.tickets != null ? chalk.gray(` — ${f._count.tickets} tickets`) : '';
    console.log(`  ${statusBadge} ${chalk.bold(f.name)}${ticketCount}`);
    console.log(chalk.gray(`    ID: ${f.id}`));
  }
  console.log();
}

function transformFeature(feature: Feature): Record<string, unknown> {
  return {
    id: feature.id,
    productId: feature.productId,
    name: feature.name,
    description: feature.description,
    vision: feature.vision,
    status: feature.status,
    effort: feature.effort,
    priority: feature.priority,
    goalId: feature.goalId,
    goal: feature.goal ?? null,
    counts: feature._count ?? null,
    createdAt: new Date(feature.createdAt).toISOString(),
    updatedAt: new Date(feature.updatedAt).toISOString(),
  };
}

function getFeatureStatusColor(status: string): 'gray' | 'blue' | 'yellow' | 'green' | 'red' {
  switch (status) {
    case 'IDEA': return 'gray';
    case 'DEFINED': return 'blue';
    case 'IN_PROGRESS': return 'yellow';
    case 'SHIPPED': return 'green';
    case 'ARCHIVED': return 'red';
    default: return 'gray';
  }
}

// ─── User story output ─────────────────────────────────────

function transformUserStory(story: UserStory): Record<string, unknown> {
  return {
    id: story.id,
    featureId: story.featureId,
    scopeId: story.scopeId,
    asA: story.asA,
    iWant: story.iWant,
    soThat: story.soThat,
    acceptanceCriteria: story.acceptanceCriteria,
    displayOrder: story.displayOrder,
    createdAt: new Date(story.createdAt).toISOString(),
    updatedAt: new Date(story.updatedAt).toISOString(),
  };
}

export function outputUserStoryJson(story: UserStory): void {
  console.log(JSON.stringify(transformUserStory(story), null, 2));
}

export function outputUserStoryPretty(story: UserStory): void {
  console.log(chalk.gray('─'.repeat(50)));
  const order = chalk.gray(`#${story.displayOrder}`);
  console.log(`\n${order} ${chalk.bold(story.iWant ?? '(no "I want")')}`);
  console.log(chalk.gray(`  ID: ${story.id}`));
  if (story.asA) console.log(`  ${chalk.cyan('As a:')} ${story.asA}`);
  if (story.iWant) console.log(`  ${chalk.cyan('I want:')} ${story.iWant}`);
  if (story.soThat) console.log(`  ${chalk.cyan('So that:')} ${story.soThat}`);
  if (story.acceptanceCriteria) {
    console.log(`  ${chalk.yellow('Acceptance:')} ${story.acceptanceCriteria}`);
  }
  if (story.scopeId) console.log(`  ${chalk.magenta('Scope:')} ${story.scopeId}`);
  console.log();
}

export function outputUserStoriesJson(stories: UserStory[]): void {
  console.log(JSON.stringify({
    userStories: stories.map(transformUserStory),
    total: stories.length,
  }, null, 2));
}

export function outputUserStoriesPretty(stories: UserStory[]): void {
  if (stories.length === 0) {
    console.log(chalk.gray('No user stories found.'));
    return;
  }
  console.log(chalk.bold(`\nUser stories (${stories.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const story of stories) {
    const order = chalk.gray(`#${story.displayOrder}`);
    const parts = [
      story.asA ? `As a ${story.asA},` : null,
      story.iWant ? `I want ${story.iWant},` : null,
      story.soThat ? `so that ${story.soThat}.` : null,
    ].filter(Boolean).join(' ');
    console.log(`  ${order} ${parts || chalk.gray('(empty)')}`);
    console.log(chalk.gray(`    ID: ${story.id}`));
  }
  console.log();
}

// Output a batch add summary (per-item success/failure).
export interface BatchStoryResult {
  index: number;
  ok: boolean;
  id?: string;
  error?: string;
}

export function outputBatchResultsJson(results: BatchStoryResult[]): void {
  const succeeded = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({
    results,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
  }, null, 2));
}

export function outputBatchResultsPretty(results: BatchStoryResult[]): void {
  const succeeded = results.filter((r) => r.ok).length;
  console.log(chalk.bold(`\nAdded ${succeeded}/${results.length} user stories`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const r of results) {
    if (r.ok) {
      console.log(`  ${chalk.green('✓')} [${r.index}] ${chalk.gray(r.id ?? '')}`);
    } else {
      console.log(`  ${chalk.red('✗')} [${r.index}] ${r.error ?? 'failed'}`);
    }
  }
  console.log();
}

// ─── Ticket output ─────────────────────────────────────────

export function outputTicketJson(ticket: Ticket | TicketDetail): void {
  console.log(JSON.stringify(transformTicket(ticket), null, 2));
}

export function outputTicketPretty(ticket: Ticket | TicketDetail): void {
  const id = ticket.shortId ?? (ticket.number != null ? `#${ticket.number}` : '?');
  console.log(chalk.gray('─'.repeat(50)));
  console.log(
    `\n${chalk[getTicketStatusColor(ticket.status)](`[${ticket.status}]`)} ${chalk.gray(`[${ticket.type}]`)} ${chalk.bold(`${id} ${ticket.title}`)}`,
  );
  console.log(chalk.gray(`  ID: ${ticket.id}`));
  if (ticket.isBlocked) {
    console.log(`  ${chalk.red('BLOCKED')} by ${ticket.openBlockerCount ?? 0} open ticket(s)`);
  } else if (ticket.openBlockerCount && ticket.openBlockerCount > 0) {
    console.log(`  ${chalk.yellow('Blockers:')} ${ticket.openBlockerCount} open (not currently in flight)`);
  }
  if (ticket.feature) {
    console.log(`  ${chalk.cyan('Feature:')} ${ticket.feature.name}`);
  }
  if (ticket.epic) {
    console.log(`  ${chalk.cyan('Epic:')} ${ticket.epic.name}`);
  }
  if (ticket.assignee) {
    console.log(`  ${chalk.magenta('Assignee:')} ${ticket.assignee.name ?? ticket.assignee.id}`);
  }
  if (ticket.priority != null) {
    console.log(`  ${chalk.magenta('Priority:')} ${ticket.priority}`);
  }
  if (ticket.points != null) {
    console.log(`  ${chalk.yellow('Points:')} ${ticket.points}`);
  }
  if (ticket.body) {
    console.log(`  ${chalk.gray('Body:')} ${ticket.body.substring(0, 200)}${ticket.body.length > 200 ? '...' : ''}`);
  }

  const detail = ticket as TicketDetail;
  if (detail.dependsOn && detail.dependsOn.length > 0) {
    console.log(`  ${chalk.cyan('Depends on:')}`);
    for (const dep of detail.dependsOn) {
      const depId = dep.shortId ?? (dep.number != null ? `#${dep.number}` : '?');
      console.log(`    - ${chalk.gray(`[${dep.status}]`)} ${depId} ${dep.title}`);
    }
  }
  if (detail.requiredFor && detail.requiredFor.length > 0) {
    console.log(`  ${chalk.cyan('Required for:')}`);
    for (const dep of detail.requiredFor) {
      const depId = dep.shortId ?? (dep.number != null ? `#${dep.number}` : '?');
      console.log(`    - ${chalk.gray(`[${dep.status}]`)} ${depId} ${dep.title}`);
    }
  }
  if (detail.actions && detail.actions.length > 0) {
    console.log(`  ${chalk.cyan('Actions:')} ${detail.actions.length}`);
    for (const a of detail.actions) {
      console.log(`    - ${chalk.gray(`[${a.kanbanStatus ?? a.status}]`)} ${a.name} ${chalk.gray(`(${a.id})`)}`);
    }
  }
  console.log();
}

export function outputTicketsJson(tickets: Ticket[]): void {
  console.log(JSON.stringify({
    tickets: tickets.map(transformTicket),
    total: tickets.length,
  }, null, 2));
}

export function outputTicketsPretty(tickets: Ticket[]): void {
  if (tickets.length === 0) {
    console.log(chalk.gray('No tickets found.'));
    return;
  }
  console.log(chalk.bold(`\nTickets (${tickets.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const t of tickets) {
    const id = t.shortId ?? (t.number != null ? `#${t.number}` : '?');
    const statusBadge = chalk[getTicketStatusColor(t.status)](`[${t.status}]`);
    const typeBadge = chalk.gray(`[${t.type}]`);
    const blocked = t.isBlocked ? chalk.red(' BLOCKED') : '';
    console.log(`  ${statusBadge} ${typeBadge} ${chalk.bold(id)} ${t.title}${blocked}`);
    console.log(chalk.gray(`    ID: ${t.id}`));
  }
  console.log();
}

function transformTicket(ticket: Ticket | TicketDetail): Record<string, unknown> {
  const detail = ticket as TicketDetail;
  return {
    id: ticket.id,
    productId: ticket.productId,
    number: ticket.number,
    shortId: ticket.shortId,
    title: ticket.title,
    body: ticket.body,
    type: ticket.type,
    status: ticket.status,
    priority: ticket.priority,
    points: ticket.points,
    branchName: ticket.branchName,
    prUrl: ticket.prUrl,
    designUrl: ticket.designUrl,
    specUrl: ticket.specUrl,
    links: ticket.links,
    epicId: ticket.epicId,
    featureId: ticket.featureId,
    cycleId: ticket.cycleId,
    scopeId: ticket.scopeId,
    assigneeId: ticket.assigneeId,
    assignee: ticket.assignee ?? null,
    feature: ticket.feature ?? null,
    epic: ticket.epic ?? null,
    openBlockerCount: ticket.openBlockerCount ?? 0,
    isBlocked: ticket.isBlocked ?? false,
    counts: ticket._count ?? null,
    dependsOn: detail.dependsOn ?? undefined,
    requiredFor: detail.requiredFor ?? undefined,
    actions: detail.actions?.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      kanbanStatus: a.kanbanStatus,
      completedAt: a.completedAt ? new Date(a.completedAt).toISOString() : null,
    })),
    completedAt: ticket.completedAt ? new Date(ticket.completedAt).toISOString() : null,
    createdAt: new Date(ticket.createdAt).toISOString(),
    updatedAt: new Date(ticket.updatedAt).toISOString(),
  };
}

function getTicketStatusColor(status: string): 'gray' | 'blue' | 'yellow' | 'cyan' | 'green' | 'red' | 'magenta' {
  switch (status) {
    case 'BACKLOG': return 'gray';
    case 'NEEDS_REFINEMENT': return 'gray';
    case 'READY_TO_PLAN': return 'blue';
    case 'COMMITTED': return 'blue';
    case 'IN_PROGRESS': return 'yellow';
    case 'BLOCKED': return 'red';
    case 'QA': return 'cyan';
    case 'DONE': return 'green';
    case 'DEPLOYED': return 'green';
    case 'ARCHIVED': return 'gray';
    default: return 'gray';
  }
}

// ─── Epic output ───────────────────────────────────────────

export function outputEpicJson(epic: Epic): void {
  console.log(JSON.stringify(transformEpic(epic), null, 2));
}

export function outputEpicPretty(epic: Epic): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${chalk[getEpicStatusColor(epic.status)](`[${epic.status}]`)} ${chalk.bold(epic.name)}`);
  console.log(chalk.gray(`  ID: ${epic.id}`));
  if (epic.description) {
    console.log(`  ${chalk.gray('Description:')} ${epic.description.substring(0, 200)}${epic.description.length > 200 ? '...' : ''}`);
  }
  console.log(`  ${chalk.magenta('Priority:')} ${epic.priority}`);
  if (epic.startDate) {
    console.log(`  ${chalk.cyan('Start:')} ${formatDate(new Date(epic.startDate))}`);
  }
  if (epic.targetDate) {
    console.log(`  ${chalk.cyan('Target:')} ${formatDate(new Date(epic.targetDate))}`);
  }
  if (epic.owner) {
    console.log(`  ${chalk.gray('Owner:')} ${epic.owner.name ?? epic.owner.email ?? epic.owner.id}`);
  }
  if (epic._count) {
    const c = epic._count;
    const parts = [
      c.actions != null ? `actions: ${c.actions}` : null,
      c.tickets != null ? `tickets: ${c.tickets}` : null,
    ].filter(Boolean);
    if (parts.length) console.log(`  ${chalk.cyan('Counts:')} ${parts.join('  ')}`);
  }
  console.log();
}

export function outputEpicsJson(epics: Epic[]): void {
  console.log(JSON.stringify({
    epics: epics.map(transformEpic),
    total: epics.length,
  }, null, 2));
}

export function outputEpicsPretty(epics: Epic[]): void {
  if (epics.length === 0) {
    console.log(chalk.gray('No epics found.'));
    return;
  }
  console.log(chalk.bold(`\nEpics (${epics.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const e of epics) {
    const statusBadge = chalk[getEpicStatusColor(e.status)](`[${e.status}]`);
    const counts = e._count
      ? chalk.gray(
          ` — ${e._count.tickets ?? 0} tickets, ${e._count.actions ?? 0} actions`,
        )
      : '';
    console.log(`  ${statusBadge} ${chalk.bold(e.name)}${counts}`);
    console.log(chalk.gray(`    ID: ${e.id}`));
  }
  console.log();
}

function transformEpic(epic: Epic): Record<string, unknown> {
  return {
    id: epic.id,
    workspaceId: epic.workspaceId,
    name: epic.name,
    description: epic.description,
    status: epic.status,
    priority: epic.priority,
    startDate: epic.startDate ? new Date(epic.startDate).toISOString() : null,
    targetDate: epic.targetDate ? new Date(epic.targetDate).toISOString() : null,
    ownerId: epic.ownerId,
    owner: epic.owner ?? null,
    counts: epic._count ?? null,
    createdAt: new Date(epic.createdAt).toISOString(),
    updatedAt: new Date(epic.updatedAt).toISOString(),
  };
}

function getEpicStatusColor(status: string): 'gray' | 'blue' | 'yellow' | 'green' | 'red' {
  switch (status) {
    case 'OPEN': return 'blue';
    case 'IN_PROGRESS': return 'yellow';
    case 'DONE': return 'green';
    case 'CANCELLED': return 'red';
    default: return 'gray';
  }
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

// ---------------------------------------------------------------------------
// Knowledge pages
// ---------------------------------------------------------------------------

export function outputPageJson(page: KnowledgePage): void {
  console.log(JSON.stringify(page, null, 2));
}

export function outputPagePretty(page: KnowledgePage): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`\n${chalk.bold(page.title)}`);
  console.log(chalk.gray(`  ID: ${page.id}`));
  if (page.project) {
    console.log(`  ${chalk.gray('Project:')} ${page.project.name}`);
  }
  if (page.body) {
    console.log(`\n${page.body}\n`);
  }
}

export function outputPagesJson(pages: KnowledgePage[]): void {
  console.log(JSON.stringify({ pages, total: pages.length }, null, 2));
}

export function outputPagesPretty(pages: KnowledgePage[]): void {
  if (pages.length === 0) {
    console.log(chalk.gray('No pages found.'));
    return;
  }
  console.log(chalk.bold(`\nPages (${pages.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const p of pages) {
    console.log(`  ${chalk.bold(p.title)}`);
    console.log(chalk.gray(`    ID: ${p.id}`));
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Requirements (EARS)
// ---------------------------------------------------------------------------

export function outputRequirementJson(requirement: Requirement): void {
  console.log(JSON.stringify(requirement, null, 2));
}

export function outputRequirementPretty(requirement: Requirement): void {
  const met = requirement.checkedAt
    ? chalk.green('[met]')
    : chalk.gray('[unmet]');
  const kind = requirement.kind ? chalk.gray(` (${requirement.kind})`) : '';
  console.log(`  ${met} ${requirement.statement}${kind}`);
  console.log(chalk.gray(`    ID: ${requirement.id}`));
}

export function outputRequirementsJson(requirements: Requirement[]): void {
  console.log(JSON.stringify({ requirements, total: requirements.length }, null, 2));
}

export function outputRequirementsPretty(requirements: Requirement[]): void {
  if (requirements.length === 0) {
    console.log(chalk.gray('No requirements found.'));
    return;
  }
  const metCount = requirements.filter((r) => r.checkedAt).length;
  console.log(chalk.bold(`\nRequirements (${metCount}/${requirements.length} met)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const r of requirements) {
    outputRequirementPretty(r);
  }
  console.log();
}

export interface BatchRequirementResult {
  index: number;
  success: boolean;
  requirement?: Requirement;
  error?: string;
}

export function outputRequirementBatchJson(results: BatchRequirementResult[]): void {
  console.log(JSON.stringify({
    results,
    total: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  }, null, 2));
}

export function outputRequirementBatchPretty(results: BatchRequirementResult[]): void {
  for (const r of results) {
    if (r.success) {
      console.log(`  ${chalk.green('✓')} #${r.index}: ${r.requirement?.statement ?? ''}`);
    } else {
      console.log(`  ${chalk.red('✗')} #${r.index}: ${r.error ?? 'failed'}`);
    }
  }
  const ok = results.filter((r) => r.success).length;
  console.log(chalk.bold(`\n${ok}/${results.length} requirements added`));
}

// ---------------------------------------------------------------------------
// Feature scopes
// ---------------------------------------------------------------------------

function getScopeStatusColor(status: string): 'gray' | 'blue' | 'yellow' | 'green' | 'red' {
  switch (status) {
    case 'PLANNED': return 'blue';
    case 'IN_PROGRESS': return 'yellow';
    case 'SHIPPED': return 'green';
    case 'DEPRECATED': return 'red';
    default: return 'gray';
  }
}

export function outputScopeJson(scope: FeatureScope): void {
  console.log(JSON.stringify(scope, null, 2));
}

export function outputScopePretty(scope: FeatureScope): void {
  const badge = chalk[getScopeStatusColor(scope.status)](`[${scope.status}]`);
  console.log(`  ${badge} ${chalk.bold(scope.version)}`);
  console.log(chalk.gray(`    ID: ${scope.id}`));
  if (scope.description) {
    console.log(`    ${scope.description.substring(0, 120)}${scope.description.length > 120 ? '...' : ''}`);
  }
}

export function outputScopesJson(scopes: FeatureScope[]): void {
  console.log(JSON.stringify({ scopes, total: scopes.length }, null, 2));
}

export function outputScopesPretty(scopes: FeatureScope[]): void {
  if (scopes.length === 0) {
    console.log(chalk.gray('No scopes found.'));
    return;
  }
  console.log(chalk.bold(`\nScopes (${scopes.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const s of scopes) {
    outputScopePretty(s);
  }
  console.log();
}

// ─── Goal (objective) output ───────────────────────────────
//
// An objective is a `Goal` with an INTEGER id; its key results are cuid-keyed
// `KeyResult` rows. Both are printed here, kept apart on purpose — the tRPC
// router mounted at `okr` is the key-result router, and conflating the two is
// the mistake this whole surface exists to stop people repeating.

function getGoalStatusColor(status: string): 'gray' | 'blue' | 'yellow' | 'green' | 'red' {
  switch (status) {
    case 'planned': return 'blue';
    case 'active': return 'yellow';
    case 'completed': return 'green';
    case 'archived': return 'gray';
    case 'on-hold': return 'red';
    default: return 'gray';
  }
}

function getKeyResultStatusColor(status: string): 'gray' | 'blue' | 'yellow' | 'green' | 'red' {
  switch (status) {
    case 'not-started': return 'gray';
    case 'on-track': return 'green';
    case 'at-risk': return 'yellow';
    case 'off-track': return 'red';
    case 'achieved': return 'green';
    default: return 'gray';
  }
}

/** Percent of the start → target span covered, clamped to 0–100. */
function keyResultProgress(kr: KeyResult): number {
  const range = kr.targetValue - kr.startValue;
  if (range <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round(((kr.currentValue - kr.startValue) / range) * 100)),
  );
}

function transformGoal(goal: Goal): Record<string, unknown> {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    period: goal.period,
    health: goal.healthOverride ?? goal.health,
    dueDate: goal.dueDate ? new Date(goal.dueDate).toISOString() : null,
    workspaceId: goal.workspaceId,
    parentGoalId: goal.parentGoalId,
    driUserId: goal.driUserId,
    lifeDomain: goal.lifeDomain ? { id: goal.lifeDomain.id, title: goal.lifeDomain.title } : null,
    projects: goal.projects?.map((p) => ({ id: p.id, name: p.name })) ?? [],
    childGoals: goal.childGoals?.map((c) => ({ id: c.id, title: c.title, status: c.status })) ?? [],
    keyResultCount: goal._count?.keyResults ?? null,
    createdAt: goal.createdAt ? new Date(goal.createdAt).toISOString() : null,
    updatedAt: goal.updatedAt ? new Date(goal.updatedAt).toISOString() : null,
  };
}

export function outputGoalJson(goal: Goal): void {
  console.log(JSON.stringify(transformGoal(goal), null, 2));
}

export function outputGoalPretty(goal: Goal): void {
  console.log(chalk.gray('─'.repeat(50)));
  const badge = chalk[getGoalStatusColor(goal.status)](`[${goal.status}]`);
  console.log(`\n${badge} ${chalk.bold(goal.title)} ${chalk.gray(`#${goal.id}`)}`);
  if (goal.period) console.log(`  ${chalk.gray('Period:')} ${goal.period}`);
  const health = goal.healthOverride ?? goal.health;
  if (health) console.log(`  ${chalk.gray('Health:')} ${health}`);
  if (goal.description) {
    console.log(`  ${chalk.gray('Description:')} ${goal.description.substring(0, 200)}${goal.description.length > 200 ? '...' : ''}`);
  }
  if (goal.parentGoal) {
    console.log(`  ${chalk.gray('Parent:')} ${goal.parentGoal.title} ${chalk.gray(`#${goal.parentGoal.id}`)}`);
  }
  if (goal.projects?.length) {
    console.log(`  ${chalk.cyan('Projects:')} ${goal.projects.map((p) => p.name).join(', ')}`);
  }
  if (goal.childGoals?.length) {
    console.log(`  ${chalk.cyan('Sub-goals:')} ${goal.childGoals.length}`);
  }
  console.log();
}

export function outputGoalsJson(goals: Goal[]): void {
  console.log(JSON.stringify({
    goals: goals.map(transformGoal),
    total: goals.length,
  }, null, 2));
}

export function outputGoalsPretty(goals: Goal[]): void {
  if (goals.length === 0) {
    console.log(chalk.gray('No goals found.'));
    return;
  }
  console.log(chalk.bold(`\nGoals (${goals.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const g of goals) {
    const badge = chalk[getGoalStatusColor(g.status)](`[${g.status}]`);
    const period = g.period ? chalk.gray(` ${g.period}`) : '';
    const krs = g._count?.keyResults ? chalk.gray(` — ${g._count.keyResults} KRs`) : '';
    console.log(`  ${badge}${period} ${chalk.bold(g.title)}${krs}`);
    console.log(chalk.gray(`    ID: ${g.id}`));
  }
  console.log();
}

function transformGoalTree(node: GoalTreeNode): Record<string, unknown> {
  return {
    ...transformGoal(node),
    keyResults: node.keyResults?.map((kr) => ({
      id: kr.id,
      status: kr.status,
      currentValue: kr.currentValue,
      targetValue: kr.targetValue,
    })) ?? [],
    children: (node.childGoals as GoalTreeNode[] | undefined)?.map(transformGoalTree) ?? [],
  };
}

export function outputGoalTreeJson(nodes: GoalTreeNode[]): void {
  console.log(JSON.stringify({
    goals: nodes.map(transformGoalTree),
    total: nodes.length,
  }, null, 2));
}

export function outputGoalTreePretty(nodes: GoalTreeNode[]): void {
  if (nodes.length === 0) {
    console.log(chalk.gray('No goals found.'));
    return;
  }
  console.log(chalk.bold('\nGoal tree'));
  console.log(chalk.gray('─'.repeat(50)));
  // The annual → quarterly cascade is the thing people come to a tree for, so
  // indent by depth rather than flattening.
  const walk = (node: GoalTreeNode, depth: number): void => {
    const pad = '  '.repeat(depth + 1);
    const badge = chalk[getGoalStatusColor(node.status)](`[${node.status}]`);
    const period = node.period ? chalk.gray(` ${node.period}`) : '';
    const krs = node.keyResults?.length ? chalk.gray(` — ${node.keyResults.length} KRs`) : '';
    console.log(`${pad}${depth > 0 ? '└ ' : ''}${badge}${period} ${chalk.bold(node.title)} ${chalk.gray(`#${node.id}`)}${krs}`);
    for (const child of (node.childGoals ?? []) as GoalTreeNode[]) {
      walk(child, depth + 1);
    }
  };
  for (const node of nodes) walk(node, 0);
  console.log();
}

export function outputGoalPeriodsJson(periods: GoalPeriod[]): void {
  console.log(JSON.stringify({ periods, total: periods.length }, null, 2));
}

export function outputGoalPeriodsPretty(periods: GoalPeriod[]): void {
  console.log(chalk.bold(`\nPeriods (${periods.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const p of periods) {
    console.log(`  ${chalk.bold(p.value)} ${chalk.gray(p.label)}`);
  }
  console.log();
}

export function outputGoalStatsJson(stats: GoalStats): void {
  console.log(JSON.stringify({
    ...stats,
    periodEndDate: stats.periodEndDate ? new Date(stats.periodEndDate).toISOString() : null,
  }, null, 2));
}

export function outputGoalStatsPretty(stats: GoalStats): void {
  console.log(chalk.bold('\nOKR stats'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  ${chalk.gray('Objectives:')}  ${stats.totalObjectives}`);
  console.log(`  ${chalk.gray('Key results:')} ${stats.totalKeyResults} (${stats.completedKeyResults} achieved)`);
  console.log(
    `  ${chalk.gray('Breakdown:')}   ` +
      `${chalk.green(`${stats.statusBreakdown.onTrack} on-track`)}, ` +
      `${chalk.yellow(`${stats.statusBreakdown.atRisk} at-risk`)}, ` +
      `${chalk.red(`${stats.statusBreakdown.offTrack} off-track`)}, ` +
      `${chalk.green(`${stats.statusBreakdown.achieved} achieved`)}`,
  );
  console.log(`  ${chalk.gray('Avg progress:')} ${stats.averageProgress}%`);
  if (stats.averageConfidence != null) {
    console.log(`  ${chalk.gray('Avg confidence:')} ${stats.averageConfidence}%`);
  }
  if (stats.periodEndDate) {
    console.log(`  ${chalk.gray('Period ends:')}  ${new Date(stats.periodEndDate).toISOString().slice(0, 10)}`);
  }
  console.log();
}

// ─── Key result output ─────────────────────────────────────

function transformKeyResult(kr: KeyResult): Record<string, unknown> {
  return {
    id: kr.id,
    goalId: kr.goalId,
    goal: kr.goal ? { id: kr.goal.id, title: kr.goal.title } : null,
    title: kr.title,
    description: kr.description,
    status: kr.statusOverride ?? kr.status,
    statusOverride: kr.statusOverride ?? null,
    startValue: kr.startValue,
    currentValue: kr.currentValue,
    targetValue: kr.targetValue,
    progress: keyResultProgress(kr),
    unit: kr.unit,
    period: kr.period,
    confidence: kr.confidence ?? null,
    driUserId: kr.driUserId,
    workspaceId: kr.workspaceId,
    projects: kr.projects?.map((l) => ({ id: l.projectId, name: l.project?.name ?? null })) ?? [],
    features: kr.features?.map((l) => ({ id: l.featureId, name: l.feature?.name ?? null })) ?? [],
    createdAt: kr.createdAt ? new Date(kr.createdAt).toISOString() : null,
    updatedAt: kr.updatedAt ? new Date(kr.updatedAt).toISOString() : null,
  };
}

export function outputKeyResultJson(kr: KeyResult): void {
  console.log(JSON.stringify(transformKeyResult(kr), null, 2));
}

export function outputKeyResultPretty(kr: KeyResult): void {
  const status = kr.statusOverride ?? kr.status;
  const badge = chalk[getKeyResultStatusColor(status)](`[${status}]`);
  console.log(`  ${badge} ${chalk.bold(kr.title)}`);
  console.log(
    chalk.gray(
      `    ${kr.currentValue}/${kr.targetValue} ${kr.unit} (${keyResultProgress(kr)}%)` +
        `${kr.period ? ` · ${kr.period}` : ''} · objective #${kr.goalId}`,
    ),
  );
  console.log(chalk.gray(`    ID: ${kr.id}`));
  if (kr.projects?.length) {
    console.log(chalk.gray(`    Projects: ${kr.projects.map((l) => l.project?.name ?? l.projectId).join(', ')}`));
  }
  if (kr.features?.length) {
    console.log(chalk.gray(`    Features: ${kr.features.map((l) => l.feature?.name ?? l.featureId).join(', ')}`));
  }
}

export function outputKeyResultsJson(keyResults: KeyResult[]): void {
  console.log(JSON.stringify({
    keyResults: keyResults.map(transformKeyResult),
    total: keyResults.length,
  }, null, 2));
}

export function outputKeyResultsPretty(keyResults: KeyResult[]): void {
  if (keyResults.length === 0) {
    console.log(chalk.gray('No key results found.'));
    return;
  }
  console.log(chalk.bold(`\nKey results (${keyResults.length} total)`));
  console.log(chalk.gray('─'.repeat(50)));
  for (const kr of keyResults) {
    outputKeyResultPretty(kr);
  }
  console.log();
}

export function outputCheckInJson(checkIn: KeyResultCheckIn): void {
  console.log(JSON.stringify({
    id: checkIn.id,
    keyResultId: checkIn.keyResultId,
    previousValue: checkIn.previousValue,
    newValue: checkIn.newValue,
    notes: checkIn.notes,
    createdAt: checkIn.createdAt ? new Date(checkIn.createdAt).toISOString() : null,
  }, null, 2));
}

export function outputCheckInPretty(checkIn: KeyResultCheckIn): void {
  console.log(`  ${chalk.gray('Value:')} ${checkIn.previousValue} → ${chalk.bold(String(checkIn.newValue))}`);
  if (checkIn.notes) console.log(`  ${chalk.gray('Note:')} ${checkIn.notes}`);
  console.log(chalk.gray(`  Check-in ID: ${checkIn.id}`));
  console.log();
}

// ─── OKR (objective + nested key results) output ───────────

function transformObjective(objective: ObjectiveWithKeyResults): Record<string, unknown> {
  return {
    id: objective.id,
    title: objective.title,
    description: objective.description,
    status: objective.status,
    period: objective.period,
    health: objective.health,
    progress: objective.progress,
    statusCounts: objective.statusCounts,
    workspaceId: objective.workspaceId,
    parentGoalId: objective.parentGoalId,
    keyResults: objective.keyResults.map(transformKeyResult),
  };
}

export function outputObjectivesJson(objectives: ObjectiveWithKeyResults[]): void {
  const totalKeyResults = objectives.reduce((n, o) => n + o.keyResults.length, 0);
  console.log(JSON.stringify({
    objectives: objectives.map(transformObjective),
    total: objectives.length,
    totalKeyResults,
  }, null, 2));
}

export function outputObjectivesPretty(objectives: ObjectiveWithKeyResults[]): void {
  if (objectives.length === 0) {
    console.log(chalk.gray('No OKRs found.'));
    return;
  }
  const totalKeyResults = objectives.reduce((n, o) => n + o.keyResults.length, 0);
  console.log(
    chalk.bold(`\nOKRs (${objectives.length} objectives, ${totalKeyResults} key results)`),
  );
  console.log(chalk.gray('─'.repeat(50)));
  for (const o of objectives) {
    const badge = chalk[getGoalStatusColor(o.status)](`[${o.status}]`);
    const period = o.period ? chalk.gray(` ${o.period}`) : '';
    console.log(
      `\n  ${badge}${period} ${chalk.bold(o.title)} ${chalk.gray(`#${o.id}`)} ${chalk.gray(`${o.progress}%`)}`,
    );
    if (o.keyResults.length === 0) {
      console.log(chalk.gray('      (no key results)'));
      continue;
    }
    for (const kr of o.keyResults) {
      const krStatus = kr.statusOverride ?? kr.status;
      const krBadge = chalk[getKeyResultStatusColor(krStatus)](`[${krStatus}]`);
      console.log(`    ${krBadge} ${kr.title} ${chalk.gray(`${kr.currentValue}/${kr.targetValue} ${kr.unit}`)}`);
      console.log(chalk.gray(`      ID: ${kr.id}`));
    }
  }
  console.log();
}
