# Discord integration

Three independent features, each enabled by its own environment variables: notifications, account linking and slash commands.

## Discord notifications

With `DISCORD_BOT_TOKEN` set, a Discord bot (REST API only, no gateway connection) posts one-line messages to the project's `discordChannelId`; projects without a channel stay silent. It announces:

- every task created from the web or the API: `🆕 \`KEY\` title · Priority · by login — link`, with a `🔥 **URGENT**` marker for urgent tasks and `· assigned to <assignee>` when created with an assignee;
- a bulk import (see [Bulk task import](import.md)), as one summary message instead of one per task;
- a task taken (`✋ <assignee> took \`KEY\` title — link`, from the web or `/take`), or assigned by an admin through `assigneeLogin` (`📌 <assignee> was assigned \`KEY\` title by login — link`);
- a linked pull request opened, reopened or merged (one message per pull request, listing its task keys; redeliveries stay silent);
- a task that is not done whose last pending dependency became `done` (status change or merge), was removed, or was deleted while not done.

Messages link to the task (`<APP_BASE_URL>/projects/<slug>/tasks/<key>`) or the pull request and escape Discord markdown in user text (titles, logins, project names), so it can never mention or ping anyone.

`<assignee>` is a Discord mention (`<@id>`) when the assignee has [linked their Discord account](#discord-account-linking) and the stored id is a valid snowflake (17–20 digits); otherwise it is their GitHub login as plain text. Mentions are disabled (`allowed_mentions: { parse: [] }`) except in one case: when someone else gave the task to a linked assignee (an admin assigning it, or creating it assigned to them), that message pings only the assignee (`allowed_mentions: { users: [id] }`). Taking a task, assigning it to yourself, imports, pull requests and unblocked tasks never ping. They are sent in the background after the database transaction commits, so a slow or failing Discord never affects the request or the webhook; failures are logged and dropped (a `429` is retried once). Invite the bot to the server with permission to send messages in those channels.

## Discord account linking

With `DISCORD_APPLICATION_ID` and `DISCORD_CLIENT_SECRET` set, signed-in users can connect their Discord account from the account menu, so Discord features can tell which task-tracker user a Discord user is. Only the `identify` scope is requested; the access token is used once to read the account id and display name, then discarded.

- `GET /auth/discord` — needs a session (otherwise redirects to `/login`); stores a random state in an HttpOnly cookie scoped to `/auth/discord` and redirects to Discord's consent screen.
- `GET /auth/discord/callback` — checks the state, links the account to the session's user and always redirects to `/?discord=<outcome>`: `linked`, `already_linked` (that Discord account belongs to another user; nothing changes), `cancelled` (consent denied) or `failed` (bad state, missing code, or Discord unreachable; logged). Linking another Discord account replaces the previous one.
- `DELETE /auth/discord` — disconnects the caller's Discord account (`204`; same-origin only).
- `GET /auth/me` includes `discord` (`{ id, username }` or `null`) and `discordLinkingEnabled`.

All three routes answer `404` `discord_linking_disabled` while linking is not configured.

## Discord slash commands

With `DISCORD_PUBLIC_KEY` set, Discord delivers slash commands to `POST /discord/interactions` (HTTP interactions, no gateway). Requests are verified with Ed25519 (`X-Signature-Ed25519` over `X-Signature-Timestamp` + raw body); a missing or invalid signature gets `401`, bodies over 64 KB get `413`, and without the key the route answers `404`. The route has no cookies, so the same-origin/JSON guards of the cookie API do not apply to it.

Commands run in the channel of a project (`discordChannelId`) and reuse the web's task use cases, so access, dependency and race rules (and channel notifications) are identical. The caller must have linked their Discord account (account menu → Connect Discord) and still be an admin or member; members only reach projects they belong to. Replies are ephemeral (only the caller sees them) and never mention anyone.

- `/tasks` — tasks you can take now (unassigned, not done, no pending dependencies), sorted like the board, up to 15.
- `/mine` — your unfinished tasks, grouped by status.
- `/task key:<KEY>` — status, priority, assignee, pending dependencies and link.
- `/take key:<KEY>` / `/release key:<KEY>` — same as the buttons in the web app.

Keys are case-insensitive, and the `key` option autocompletes from the channel's project (takeable tasks for `/take`, yours for `/release`).

Setup, in the [Discord developer portal](https://discord.com/developers/applications) for the same application as account linking:

1. **General Information**: copy the **Public Key** into `DISCORD_PUBLIC_KEY`, deploy, then set **Interactions Endpoint URL** to `<APP_BASE_URL>/discord/interactions` (Discord sends a signed PING when saving it, so the app must already run with the key).
2. **Installation**: the bot needs the `applications.commands` scope in the server (re-invite it with `bot` + `applications.commands` if it was invited with `bot` only).
3. Register the commands (again whenever their definitions change). It needs `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`; with `DISCORD_GUILD_ID` set it registers them in that server only, which applies instantly (global commands can take a while to appear):
   - locally: `pnpm --filter @task-tracker/server discord:register` (reads `.env`);
   - in production (Dokploy), inside the running app container, which already has the variables: `docker exec <app-container> node dist/discord-register.js` (or `docker exec -e DISCORD_GUILD_ID=<guild id> <app-container> node dist/discord-register.js`).

