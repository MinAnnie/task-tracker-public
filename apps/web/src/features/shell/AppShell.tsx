import { useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import type { CurrentUser, Project } from "../../api/types.ts";
import { paths } from "../../lib/paths.ts";
import { LogoIcon, MenuIcon } from "../../ui/icons.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import type { Notice } from "./discord-notice.ts";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  user: CurrentUser;
  projects: Project[];
  /** Project of the current page, if any. */
  currentSlug?: string;
  /** The switcher only shows on the board, as in the design. */
  showProjectSwitcher: boolean;
  onProjectChange: (slug: string) => void;
  onLogout: () => void;
  loggingOut: boolean;
  onDisconnectDiscord: () => void;
  disconnectingDiscord: boolean;
  /** Account-level message, e.g. the outcome of connecting Discord. */
  notice?: Notice;
  onDismissNotice: () => void;
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  const { user, projects, currentSlug } = props;
  const currentProject = projects.find((project) => project.slug === currentSlug);
  const [menuOpen, setMenuOpen] = useState(false);
  const navClass = ({ isActive }: { isActive: boolean }) => `${styles.navLink} ${isActive ? styles.active : ""}`;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.menuToggle}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
          <div className={styles.brand}>
            <LogoIcon />
            Task Tracker
          </div>
          {props.showProjectSwitcher && projects.length > 0 && (
            <label className={styles.switcher}>
              <span className={styles.switcherLabel}>Project</span>
              <select value={currentProject?.slug ?? ""} onChange={(event) => props.onProjectChange(event.target.value)}>
                {/* The URL's project isn't one of theirs (or doesn't exist): select nothing. */}
                {!currentProject && (
                  <option value="" disabled>
                    Choose a project
                  </option>
                )}
                {projects.map((project) => (
                  <option key={project.slug} value={project.slug}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <nav id="main-nav" aria-label="Main" className={styles.nav} data-open={menuOpen}>
            <NavLink
              to={currentSlug ? paths.board(currentSlug) : paths.home}
              end={!currentSlug}
              className={navClass}
              onClick={() => setMenuOpen(false)}
            >
              Board
            </NavLink>
            {user.role === "admin" && (
              <NavLink to={paths.admin} className={navClass} onClick={() => setMenuOpen(false)}>
                Admin
              </NavLink>
            )}
          </nav>
          <AccountMenu
            user={user}
            onLogout={props.onLogout}
            loggingOut={props.loggingOut}
            onDisconnectDiscord={props.onDisconnectDiscord}
            disconnectingDiscord={props.disconnectingDiscord}
          />
        </div>
      </header>
      <main className={styles.main}>
        {props.notice && (
          <div className={`${styles.notice} ${props.notice.tone === "error" ? styles.noticeError : ""}`}>
            <p role={props.notice.tone === "error" ? "alert" : "status"}>{props.notice.text}</p>
            <button type="button" className={styles.dismiss} onClick={props.onDismissNotice}>
              Dismiss
            </button>
          </div>
        )}
        {props.children}
      </main>
    </div>
  );
}
