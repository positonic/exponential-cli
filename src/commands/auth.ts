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
    .requiredOption('--token <token>', 'JWT token from /tokens page')
    .requiredOption('--api-url <url>', 'API URL (e.g., https://app.exponential.so)')
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
    .description('Show current authentication status')
    .action(async () => {
      if (!isAuthenticated()) {
        console.log(chalk.yellow('Not authenticated.'));
        console.log(chalk.gray('Run: exponential auth login --token <jwt> --api-url <url>'));
        process.exit(1);
      }

      try {
        const config = getConfig();
        const client = getClient();

        // Validate token by listing workspaces
        const workspaces = await client.workspaces.list();

        console.log(chalk.green('Authenticated'));
        console.log(chalk.gray(`API URL: ${config.apiUrl}`));
        console.log(chalk.gray(`Workspaces: ${(workspaces as unknown[]).length}`));
        console.log(chalk.gray(`Config: ${getConfigPath()}`));
      } catch (error) {
        handleError(error);
      }
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
