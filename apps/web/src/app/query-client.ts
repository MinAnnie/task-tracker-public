import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isApiError } from "../api/client.ts";
import { queryKeys } from "../api/queries.ts";

/**
 * Server state lives in TanStack Query. A 401 from any call means the session
 * ended (expired, revoked, or the member was removed): clearing the current user
 * makes the auth guard send the browser to the login screen.
 */
export function createQueryClient(): QueryClient {
  const onError = (error: unknown) => {
    if (isApiError(error) && error.status === 401) client.setQueryData(queryKeys.me, null);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        // 4xx answers are final; retry only network and server failures, twice.
        retry: (failureCount, error) =>
          failureCount < 2 && !(isApiError(error) && error.status >= 400 && error.status < 500),
        refetchOnWindowFocus: true,
        staleTime: 10_000,
      },
    },
  });
  return client;
}
