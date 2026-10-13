export interface Config {
  /** The project-scoped API token; `undefined` when `TRACKER_API_TOKEN` is unset or blank. */
  token: string | undefined;
  /** Base URL of the Task Tracker, without a trailing slash; `undefined` when `TRACKER_API_URL` is unset or blank. */
  apiUrl: string | undefined;
  /** Lowercased default project slug, if configured. */
  project: string | undefined;
}

/**
 * The trimmed value, or `undefined` when blank or an unexpanded `${VAR}` placeholder
 * (Claude Code passes `${VAR}` through literally when the variable is unset).
 */
const present = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed && !/^\$\{[^}]*\}$/.test(trimmed) ? trimmed : undefined;
};

/** Reads the server configuration from environment variables. */
export function readConfig(env: Record<string, string | undefined>): Config {
  return {
    token: present(env.TRACKER_API_TOKEN),
    apiUrl: present(env.TRACKER_API_URL)?.replace(/\/+$/, "") || undefined,
    project: present(env.TRACKER_PROJECT)?.toLowerCase(),
  };
}
