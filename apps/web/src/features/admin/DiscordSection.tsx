import { useId, useState, type FormEvent } from "react";
import type { DiscordChannelOption, DiscordChannelWarning } from "../../api/types.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";

/** Copy for the follow-ups that failed after a channel was saved. */
export const DISCORD_WARNINGS: Record<DiscordChannelWarning, string> = {
  commands_not_registered:
    "The slash commands couldn’t be registered in this server. Notifications still work; try saving again later.",
  invite_not_created:
    "Discord couldn’t create an invite for this channel, so the board keeps its previous Discord link. Check that the bot may create invites there.",
};

export interface DiscordSectionProps {
  /** Full-page link that starts the bot authorization on Discord. */
  connectUrl: string;
  /** Whether the project already has a connected Discord server. */
  connected: boolean;
  /** The channel the project posts to, if any. */
  channelId: string | null;
  /** The connected server's channels; `undefined` while loading. */
  channels: DiscordChannelOption[] | undefined;
  /** Why the channels could not be loaded. */
  loadError?: string;
  /** Outcome of the last connection attempt, from the redirect. */
  outcome?: { tone: "success" | "error"; text: string };
  onSave: (channelId: string) => Promise<unknown>;
  saving: boolean;
  /** Why the last save failed. */
  saveError?: string;
  /** Non-blocking problems of the last successful save. */
  warnings: DiscordChannelWarning[];
}

const optionLabel = (channel: DiscordChannelOption) =>
  channel.usedBy ? `#${channel.name} — used by ${channel.usedBy.name}` : `#${channel.name}`;

/** Connects the project to a Discord server and picks the channel the bot posts to. */
export function DiscordSection({
  connectUrl,
  connected,
  channelId,
  channels,
  loadError,
  outcome,
  onSave,
  saving,
  saveError,
  warnings,
}: DiscordSectionProps) {
  const selectId = useId();
  const [picked, setPicked] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const known = channels?.some((channel) => channel.id === channelId) ? channelId : null;
  const value = picked ?? known ?? "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(undefined);
    if (value === "") return;
    try {
      await onSave(value);
      setNotice("Saved.");
    } catch {
      // The container shows the server's reason.
    }
  }

  return (
    <section aria-labelledby="discord-h" className={styles.card}>
      <div>
        <h2 id="discord-h" className={styles.cardTitle}>
          Discord
        </h2>
        <p className={styles.cardHint}>
          {connected
            ? "The bot posts task updates to the channel you pick, and the board links to it."
            : "Add the bot to your Discord server, then pick the channel it posts task updates to. No IDs to copy."}
        </p>
      </div>

      {outcome?.tone === "error" && <Alert tone="error">{outcome.text}</Alert>}
      {outcome?.tone === "success" && (
        <p role="status" className={styles.notice}>
          {outcome.text}
        </p>
      )}

      {!connected && (
        <div>
          <a href={connectUrl} className={`${buttons.button} ${buttons.primary}`}>
            Connect Discord
          </a>
        </div>
      )}

      {connected && (
        <form aria-label="Discord channel" onSubmit={submit} className={styles.stack} noValidate>
          {loadError && <Alert tone="error">{loadError}</Alert>}
          {saveError && <Alert tone="error">{saveError}</Alert>}
          <div className={`${styles.field} ${styles.channelField}`}>
            <label htmlFor={selectId}>Channel</label>
            <select
              id={selectId}
              className={styles.input}
              value={value}
              disabled={channels === undefined}
              onChange={(event) => {
                setNotice(undefined);
                setPicked(event.target.value);
              }}
            >
              <option value="" disabled>
                {channels === undefined ? "Loading channels…" : "Pick a channel"}
              </option>
              {channels?.map((channel) => (
                <option key={channel.id} value={channel.id} disabled={channel.usedBy !== null}>
                  {optionLabel(channel)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formActions}>
            <button
              type="submit"
              className={`${buttons.button} ${buttons.primary}`}
              disabled={saving || value === "" || channels === undefined}
            >
              {saving ? "Saving…" : "Save channel"}
            </button>
            <a href={connectUrl} className={`${buttons.button} ${buttons.accentOutline}`}>
              Connect another server
            </a>
            <span role="status" className={styles.notice}>
              {notice}
            </span>
          </div>
          {warnings.map((warning) => (
            <p key={warning} className={styles.warning}>
              {DISCORD_WARNINGS[warning]}
            </p>
          ))}
        </form>
      )}
    </section>
  );
}
