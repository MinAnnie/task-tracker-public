import { useEffect, useRef, useState } from "react";
import { CONNECT_DISCORD_URL } from "../../api/endpoints.ts";
import type { CurrentUser } from "../../api/types.ts";
import { initials } from "../../lib/initials.ts";
import styles from "./AppShell.module.css";

interface AccountMenuProps {
  user: CurrentUser;
  onLogout: () => void;
  loggingOut: boolean;
  onDisconnectDiscord: () => void;
  disconnectingDiscord: boolean;
}

/**
 * Disclosure with the account name, the Discord connection (when the server
 * supports linking) and "Sign out"; closes on Escape or an outside click.
 */
export function AccountMenu({ user, onLogout, loggingOut, onDisconnectDiscord, disconnectingDiscord }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.account} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.avatarButton}
        aria-label={`Account menu for ${user.githubLogin}`}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((value) => !value)}
      >
        {initials({ login: user.githubLogin, name: user.name })}
      </button>
      {open && (
        <div id="account-menu" className={styles.accountPanel}>
          <p className={styles.accountName}>
            {user.name ?? user.githubLogin}
            <span className="mono">@{user.githubLogin}</span>
          </p>
          {user.discordLinkingEnabled &&
            (user.discord ? (
              <>
                <p className={styles.discordAccount}>Discord: {user.discord.username}</p>
                <button
                  type="button"
                  className={styles.signOut}
                  onClick={onDisconnectDiscord}
                  disabled={disconnectingDiscord}
                >
                  Disconnect Discord
                </button>
              </>
            ) : (
              // Full-page navigation: the server redirects to Discord and back.
              <a href={CONNECT_DISCORD_URL} className={styles.signOut}>
                Connect Discord
              </a>
            ))}
          <button type="button" className={styles.signOut} onClick={onLogout} disabled={loggingOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
