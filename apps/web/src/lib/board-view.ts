import { readStored, writeStored } from "./storage.ts";

const key = (slug: string) => `task-tracker:board-view:${slug}`;

/**
 * The query string (filters and sort, with its `?`, or empty) of the project's board
 * as this browser left it, so going back from a task returns to the same view.
 */
export const readBoardView = (slug: string) => readStored(key(slug)) ?? "";
export const rememberBoardView = (slug: string, search: string) => writeStored(key(slug), search);
