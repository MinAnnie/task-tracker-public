/**
 * Uploads the slash command definitions to Discord. Run it after deploying a change
 * to the commands: `pnpm --filter @task-tracker/server discord:register` locally, or
 * `node dist/discord-register.js` inside the production container.
 */
import { registerDiscordCommands, registerOptionsFromEnv } from "./infrastructure/discord-command-registrar.ts";

try {
  const { scope, count } = await registerDiscordCommands(registerOptionsFromEnv(process.env));
  console.log(`Registered ${count} Discord commands (${scope}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
