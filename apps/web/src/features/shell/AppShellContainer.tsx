import { useEffect, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { useCurrentUser, useDisconnectDiscord, useLogout, useProjects } from "../../api/queries.ts";
import { rememberLastProject } from "../../lib/last-project.ts";
import { paths } from "../../lib/paths.ts";
import { AppShell } from "./AppShell.tsx";
import { DISCONNECT_FAILED, DISCORD_PARAM, discordNotice, parseDiscordOutcome, type Notice } from "./discord-notice.ts";

/** Layout route for signed-in pages (inside RequireAuth, so the user is known). */
export function AppShellContainer() {
  const user = useCurrentUser().data;
  const projects = useProjects().data ?? [];
  const logout = useLogout();
  const disconnectDiscord = useDisconnectDiscord();
  const navigate = useNavigate();
  const location = useLocation();
  // The Discord callback lands here with `?discord=<outcome>`; keep it as a notice.
  const [outcome] = useState(() => parseDiscordOutcome(new URLSearchParams(location.search).get(DISCORD_PARAM)));
  const [notice, setNotice] = useState<Notice | undefined>();
  const [outcomeDismissed, setOutcomeDismissed] = useState(false);

  // Drop the flag from the URL (replacing history) so a reload doesn't repeat the message.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has(DISCORD_PARAM)) return;
    params.delete(DISCORD_PARAM);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
    // Only the URL the shell was opened with carries the flag, so this runs once.
  }, []);

  const inProject = useMatch("/projects/:slug/*");
  const onBoard = useMatch("/projects/:slug");
  const onNewTask = useMatch("/projects/:slug/tasks/new");

  if (!user) return null;
  const shown = notice ?? (outcome && !outcomeDismissed ? discordNotice(outcome, user.discord?.username) : undefined);
  return (
    <AppShell
      user={user}
      projects={projects}
      currentSlug={inProject?.params.slug}
      showProjectSwitcher={Boolean(onBoard ?? onNewTask)}
      onProjectChange={(slug) => {
        rememberLastProject(slug);
        navigate(paths.board(slug));
      }}
      onLogout={() => logout.mutate(undefined, { onSettled: () => navigate(paths.login, { replace: true }) })}
      loggingOut={logout.isPending}
      onDisconnectDiscord={() => {
        setNotice(undefined);
        disconnectDiscord.mutate(undefined, { onError: () => setNotice(DISCONNECT_FAILED) });
      }}
      disconnectingDiscord={disconnectDiscord.isPending}
      notice={shown}
      onDismissNotice={() => {
        setNotice(undefined);
        setOutcomeDismissed(true);
      }}
    >
      <Outlet />
    </AppShell>
  );
}
