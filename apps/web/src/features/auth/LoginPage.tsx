import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { AlertIcon, LogoIcon, SignInIcon } from "../../ui/icons.tsx";
import styles from "./LoginPage.module.css";

/** Full-page navigation: the server redirects to GitHub and back. */
const GITHUB_SIGN_IN = "/auth/github";

interface LoginPageProps {
  /** Set when the OAuth callback refused the account; `""` when its login is unknown. */
  deniedLogin?: string;
}

export function LoginPage({ deniedLogin }: LoginPageProps) {
  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <LogoIcon size={24} />
          Task Tracker
        </div>

        {deniedLogin === undefined ? (
          <div className={styles.stack}>
            <div>
              <h1 className={styles.title}>Sign in</h1>
              <p className={styles.lead}>Use your GitHub account. Only people added by an admin can get in.</p>
            </div>
            <a href={GITHUB_SIGN_IN} className={`${buttons.button} ${buttons.dark}`}>
              <SignInIcon />
              Continue with GitHub
            </a>
            <p className={styles.note}>We only read your public profile: username, name and avatar.</p>
          </div>
        ) : (
          <div className={styles.stack}>
            <h1 className="sr-only">Sign in</h1>
            <Alert tone="error" title="No access yet" icon={<AlertIcon />}>
              {deniedLogin ? (
                <>
                  The GitHub account <span className="mono">@{deniedLogin}</span> isn’t a member.
                </>
              ) : (
                "This GitHub account isn’t a member."
              )}{" "}
              Ask an admin to add you, then try again.
            </Alert>
            <a href={GITHUB_SIGN_IN} className={`${buttons.button} ${styles.retry}`}>
              Try again
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
