import type { AuthStore, DiscordAccount } from "./auth-store.ts";

/** Port for the Discord OAuth2 code grant. Implemented by an HTTP adapter. */
export interface DiscordOAuthClient {
  /** Trades an authorization `code` for an access token; throws when Discord refuses it. */
  exchangeCode(code: string): Promise<string>;
  /** Reads the account owning `accessToken`. */
  fetchUser(accessToken: string): Promise<DiscordAccount>;
}

export interface CompleteDiscordLinkDeps {
  store: AuthStore;
  discord: DiscordOAuthClient;
}

export type CompleteDiscordLinkResult =
  | { status: "linked"; account: DiscordAccount }
  | { status: "already_linked" };

/**
 * Finishes linking the Discord account behind `code` to a signed-in user.
 *
 * - A Discord account linked to another user is left untouched (`already_linked`).
 * - Linking replaces any account the user had linked before.
 * - The access token is used once to read the account and then discarded.
 */
export async function completeDiscordLink(
  { store, discord }: CompleteDiscordLinkDeps,
  userId: number,
  code: string,
): Promise<CompleteDiscordLinkResult> {
  const accessToken = await discord.exchangeCode(code);
  const account = await discord.fetchUser(accessToken);

  return store.transaction(async (tx) => {
    const ownerId = await tx.findUserIdByDiscordId(account.id);
    if (ownerId !== undefined && ownerId !== userId) return { status: "already_linked" } as const;
    await tx.setDiscordAccount(userId, account);
    return { status: "linked", account } as const;
  });
}

/** Removes the user's Discord link; a user without one is left as is. */
export async function unlinkDiscordAccount(store: AuthStore, userId: number): Promise<void> {
  await store.setDiscordAccount(userId, null);
}

export async function findDiscordAccount(store: AuthStore, userId: number): Promise<DiscordAccount | null> {
  return store.findDiscordAccount(userId);
}
