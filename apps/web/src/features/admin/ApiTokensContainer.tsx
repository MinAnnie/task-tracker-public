import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from "../../api/queries.ts";
import type { ApiToken, CreatedApiToken, NewApiTokenInput } from "../../api/types.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { apiTokenUsageHint } from "./admin-model.ts";
import { ApiTokensSection, type ApiTokensSectionProps } from "./ApiTokensSection.tsx";
import { NewTokenDialog } from "./NewTokenDialog.tsx";

export interface ApiTokensManagerProps
  extends Pick<ApiTokensSectionProps, "hint" | "allowWrite" | "readOnlyNote"> {
  tokens: UseQueryResult<ApiToken[]>;
  create: UseMutationResult<CreatedApiToken, unknown, NewApiTokenInput>;
  revoke: UseMutationResult<void, unknown, number>;
  /** Example command shown with a new token; it must reference `$TRACKER_API_TOKEN`, never the secret. */
  usageHint: string;
}

/** A list of API tokens with create (showing the secret once) and revoke, over the given queries. */
export function ApiTokensManager({ tokens, create, revoke, usageHint, ...sectionProps }: ApiTokensManagerProps) {
  // The secret lives only here, and only until the dialog closes.
  const [created, setCreated] = useState<{ name: string; token: string }>();
  const [tokenToRevoke, setTokenToRevoke] = useState<ApiToken>();

  async function createToken(input: NewApiTokenInput) {
    const result = await create.mutateAsync(input);
    setCreated({ name: result.name, token: result.token });
    // Drops the response (and its secret) from the mutation cache.
    create.reset();
  }

  const closeRevoke = () => {
    setTokenToRevoke(undefined);
    revoke.reset();
  };

  return (
    <>
      <ApiTokensSection
        {...sectionProps}
        tokens={tokens.data}
        loadError={tokens.isError ? errorMessage(tokens.error) : undefined}
        onCreate={createToken}
        creating={create.isPending}
        error={create.isError ? errorMessage(create.error) : undefined}
        onRevoke={setTokenToRevoke}
      />

      {created !== undefined && (
        <NewTokenDialog
          name={created.name}
          token={created.token}
          usageHint={usageHint}
          onClose={() => setCreated(undefined)}
        />
      )}

      {tokenToRevoke !== undefined && (
        <ConfirmDialog
          title={`Revoke ${tokenToRevoke.name}?`}
          confirmLabel="Revoke"
          busyLabel="Revoking…"
          busy={revoke.isPending}
          error={revoke.isError ? errorMessage(revoke.error) : undefined}
          onCancel={closeRevoke}
          onConfirm={() => revoke.mutate(tokenToRevoke.id, { onSuccess: closeRevoke })}
        >
          Anything using it stops working immediately.
        </ConfirmDialog>
      )}
    </>
  );
}

/** The project's API tokens: list, create (showing the secret once) and revoke. */
export function ApiTokensContainer({ slug }: { slug: string }) {
  return (
    <ApiTokensManager
      tokens={useApiTokens(slug)}
      create={useCreateApiToken(slug)}
      revoke={useRevokeApiToken(slug)}
      usageHint={apiTokenUsageHint(window.location.origin, slug)}
    />
  );
}
