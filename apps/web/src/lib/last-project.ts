import { readStored, writeStored } from "./storage.ts";

const KEY = "task-tracker:last-project";

/** Slug of the project this browser opened last, if remembered. */
export const readLastProject = () => readStored(KEY);
export const rememberLastProject = (slug: string) => writeStored(KEY, slug);
