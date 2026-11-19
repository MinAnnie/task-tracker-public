import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { connectDiscordBotUrl } from "../../api/endpoints.ts";
import { useDiscordChannels, useSelectDiscordChannel } from "../../api/queries.ts";
import type { AdminProject, DiscordChannelWarning } from "../../api/types.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { DiscordSection, type DiscordSectionProps } from "./DiscordSection.tsx";

/** The server's bot-install callback lands on the project settings with `?discordBot=<outcome>`. */
export const DISCORD_BOT_PARAM = "discordBot";

const OUTCOMES: Record<string, NonNullable<DiscordSectionProps["outcome"]>> = {
  connected: { tone: "success", text: "Discord server connected. Pick the channel for updates." },
  cancelled: { tone: "success", text: "Discord connection cancelled." },
  failed: { tone: "error", text: "Couldn’t connect Discord. Try again." },
};

/** "Connect Discord" for one project: bot install, then the channel picker. */
export function DiscordContainer({ project }: { project: AdminProject }) {
  const { slug } = project;
  const connected = project.discordGuildId !== null;
  const channels = useDiscordChannels(slug, { enabled: connected });
  const select = useSelectDiscordChannel(slug);
  const [warnings, setWarnings] = useState<DiscordChannelWarning[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  // Read once: the param is removed right away so a reload does not repeat the notice.
  const [outcome] = useState(() => OUTCOMES[searchParams.get(DISCORD_BOT_PARAM) ?? ""]);

  useEffect(() => {
    if (!searchParams.has(DISCORD_BOT_PARAM)) return;
    const next = new URLSearchParams(searchParams);
    next.delete(DISCORD_BOT_PARAM);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <DiscordSection
      connectUrl={connectDiscordBotUrl(slug)}
      connected={connected}
      channelId={project.discordChannelId}
      channels={channels.data?.channels}
      loadError={channels.isError ? errorMessage(channels.error) : undefined}
      outcome={outcome}
      onSave={async (channelId) => {
        setWarnings([]);
        const saved = await select.mutateAsync(channelId);
        setWarnings(saved.warnings);
      }}
      saving={select.isPending}
      saveError={select.isError ? errorMessage(select.error) : undefined}
      warnings={warnings}
    />
  );
}
