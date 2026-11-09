import { Command } from 'commander';
import chalk from 'chalk';
import { getConfig, setConfig, clearConfig, isAuthenticated, getConfigPath } from '../config/index.js';
import { getClient, resetClient } from '../client/index.js';
import { handleError } from '../utils/errors.js';

export function createAuthCommand(): Command {
  const auth = new Command('auth')
    .description('Authentication commands');

  auth
    .command('login')
    .description('Configure CLI with your API token')
    .requiredOption('--token <token>', 'JWT token from /settings/api-keys')
    .requiredOption('--api-url <url>', 'API URL (e.g., https://www.exponential.im)')
    .action(async (options: { token: string; apiUrl: string }) => {
      try {
        // Normalize API URL (remove trailing slash)
        let apiUrl = options.apiUrl.replace(/\/+$/, '');

        // Ensure HTTPS for non-localhost
        if (!apiUrl.startsWith('http://localhost') && !apiUrl.startsWith('https://')) {
          apiUrl = `https://${apiUrl}`;
        }

        // Store the config
        setConfig({
          token: options.token,
          apiUrl: apiUrl,
        });

        // Reset client to use new config
        resetClient();

        // Validate by trying to list workspaces
        console.log(chalk.gray('Validating token...'));
        const client = getClient();
        await client.workspaces.list();

        console.log(chalk.green('Successfully authenticated!'));
        console.log(chalk.gray(`Config saved to: ${getConfigPath()}`));
      } catch (error) {
        // Clear invalid config
        clearConfig();
        handleError(error);
      }
    });

  auth
    .command('logout')
    .description('Remove stored credentials')
    .action(() => {
      clearConfig();
      resetClient();
      console.log(chalk.green('Successfully logged out.'));
      console.log(chalk.gray(`Config cleared from: ${getConfigPath()}`));
    });

  auth
    .command('whoami')
    .description('Show which account the stored token signs in as, and whether it is an agent')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      if (!isAuthenticated()) {
        if (options.json) {
          console.log(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } }, null, 2));
        } else {
          console.log(chalk.yellow('Not authenticated.'));
          console.log(chalk.gray('Run: exponential auth login --token <jwt> --api-url <url>'));
        }
        process.exit(1);
      }

      try {
        const config = getConfig();
        const client = getClient();

        // The account behind the token — an agent's shadow user for an
        // exp_agent_… key — plus the workspaces it can see.
        const [me, workspaces] = await Promise.all([
          client.users.me(),
          client.workspaces.list(),
        ]);
        const workspaceCount = (workspaces as unknown[]).length;

        if (options.json) {
          console.log(JSON.stringify({
            id: me.id,
            name: me.name,
            email: me.email,
            isAgent: me.isAgent,
            agent: me.agent,
            apiUrl: config.apiUrl,
            workspaces: workspaceCount,
            configPath: getConfigPath(),
          }, null, 2));
          return;
        }

        console.log(chalk.green('Authenticated'));
        console.log(`Account: ${chalk.bold(me.name ?? '(unnamed)')} ${chalk.gray(`(${me.id})`)}`);
        if (me.email) {
          console.log(chalk.gray(`Email: ${me.email}`));
        }
        if (me.isAgent) {
          const owner = me.agent?.owner.name ?? me.agent?.owner.id ?? 'unknown';
          console.log(`Type: ${chalk.cyan('External agent')} ${chalk.gray(`owned by ${owner}`)}`);
          console.log(chalk.gray('To give this agent a restricted project, add this account on the project\'s Members tab.'));
        } else {
          console.log(`Type: ${chalk.cyan('Person')}`);
        }
        console.log(chalk.gray(`API URL: ${config.apiUrl}`));
        console.log(chalk.gray(`Workspaces: ${workspaceCount}`));
        console.log(chalk.gray(`Config: ${getConfigPath()}`));
      } catch (error) {
        handleError(error, options.json);
      }
    });

  auth
    .command('show')
    .description(
      'Print parts of the current credentials. Use --token to print the raw JWT (for piping into other tools, e.g. `gh secret set EXPONENTIAL_TOKEN < <(exponential auth show --token)`).',
    )
    .option('--token', 'Print the raw JWT to stdout with no trailing newline')
    .action((options: { token?: boolean }) => {
      const config = getConfig();
      if (options.token) {
        if (!config.token) {
          console.error('Not authenticated. Run `exponential auth login` first.');
          process.exit(1);
        }
        process.stdout.write(config.token);
        return;
      }
      console.log(chalk.bold('\nCredentials'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`API URL: ${config.apiUrl || chalk.gray('(not set)')}`);
      console.log(
        `Token: ${config.token ? chalk.gray(`${config.token.substring(0, 20)}...`) : chalk.gray('(not set)')}`,
      );
      console.log(
        chalk.gray('Use `exponential auth show --token` to print the raw JWT.'),
      );
      console.log();
    });

  auth
    .command('status')
    .description('Show detailed authentication status')
    .action(() => {
      const config = getConfig();

      console.log(chalk.bold('\nAuthentication Status'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);
      console.log(`API URL: ${config.apiUrl || chalk.gray('(not set)')}`);
      console.log(`Token: ${config.token ? chalk.gray(`${config.token.substring(0, 20)}...`) : chalk.gray('(not set)')}`);
      console.log(`Config Path: ${getConfigPath()}`);
      console.log();
    });

  return auth;
}
