import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client.ts";
import { queryKeys } from "../api/queries.ts";
import { me } from "../test/fixtures.ts";
import { createQueryClient } from "./query-client.ts";

describe("createQueryClient", () => {
  it("forgets the current user when any request answers 401, so the app sends them to login", async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, me);

    await client
      .fetchQuery({
        queryKey: ["projects"],
        queryFn: () => Promise.reject(new ApiError(401, "unauthenticated")),
      })
      .catch(() => {});

    expect(client.getQueryData(queryKeys.me)).toBeNull();
  });

  it("does not retry client errors", async () => {
    const client = createQueryClient();
    let attempts = 0;
    await client
      .fetchQuery({
        queryKey: ["x"],
        queryFn: () => {
          attempts += 1;
          return Promise.reject(new ApiError(404, "task_not_found"));
        },
        retry: client.getDefaultOptions().queries?.retry,
      })
      .catch(() => {});
    expect(attempts).toBe(1);
  });
});
