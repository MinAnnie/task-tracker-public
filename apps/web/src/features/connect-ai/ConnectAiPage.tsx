import { Link } from "react-router";
import { useCopyFeedback } from "../../lib/clipboard.ts";
import { paths } from "../../lib/paths.ts";
import buttons from "../../ui/Button.module.css";
import accountStyles from "../account/Account.module.css";
import adminStyles from "../admin/Admin.module.css";
import { clientSnippets, TOKEN_PLACEHOLDER } from "./connect-ai-model.ts";
import styles from "./ConnectAi.module.css";

export interface ConnectAiPageProps {
  /** This app's remote MCP endpoint. */
  endpoint: string;
}

/** Setup guide for using the tracker's MCP tools from AI clients, with nothing to install. */
export function ConnectAiPage({ endpoint }: ConnectAiPageProps) {
  const { outcome, copy } = useCopyFeedback<string>();
  const feedback = (id: string) => {
    if (outcome?.id !== id) return "";
    return outcome.status === "copied" ? "Copied" : "Couldn’t copy. Select the text and copy it.";
  };

  const copyButton = (id: string, label: string, text: string) => (
    <>
      <button
        type="button"
        className={`${buttons.button} ${buttons.small}`}
        aria-label={label}
        onClick={() => copy(id, text)}
      >
        Copy
      </button>
      <span role="status" className={adminStyles.notice}>
        {feedback(id)}
      </span>
    </>
  );

  return (
    <div className={`${accountStyles.layout} ${adminStyles.page}`}>
      <div>
        <h1 className={adminStyles.title}>Connect your AI</h1>
        <p className={adminStyles.lede}>
          Let Claude, Copilot, Cursor and other AI tools read your tasks and, with a Read &amp; write token, create and
          edit them. Nothing to install: they connect to this tracker’s MCP server over the internet.
        </p>
      </div>

      <section aria-labelledby="connect-ai-endpoint" className={adminStyles.card}>
        <h2 id="connect-ai-endpoint" className={adminStyles.cardTitle}>
          Endpoint
        </h2>
        <p className={styles.text}>The MCP server URL (Streamable HTTP) to give your AI client:</p>
        <div className={adminStyles.webhookRow}>
          <code className={`mono ${adminStyles.webhookUrl}`}>{endpoint}</code>
          {copyButton("endpoint", "Copy endpoint URL", endpoint)}
        </div>
      </section>

      <section aria-labelledby="connect-ai-token" className={adminStyles.card}>
        <h2 id="connect-ai-token" className={adminStyles.cardTitle}>
          Token
        </h2>
        <ol className={styles.steps}>
          <li>
            <Link to={paths.accountTokens}>Create a personal token</Link>. It works with every project you can access.
            Choose Read only unless the AI should create and edit tasks (Read &amp; write, admins only).
          </li>
          <li>
            Copy it right away: it is shown only once. In the snippets below, replace{" "}
            <code className="mono">{TOKEN_PLACEHOLDER}</code> with it.
          </li>
          <li>Treat it like a password. Revoke it from the same page if it leaks; clients using it stop at once.</li>
        </ol>
        <p className={adminStyles.cardHint}>
          A project token (Admin → project → API tokens) works too, limited to that one project.
        </p>
      </section>

      {clientSnippets(endpoint).map((client) => {
        const headingId = `connect-ai-${client.id}`;
        return (
          <section key={client.id} aria-labelledby={headingId} className={adminStyles.card}>
            <div className={styles.snippetHeader}>
              <h2 id={headingId} className={adminStyles.cardTitle}>
                {client.name}
              </h2>
              <a className={styles.docs} href={client.docsUrl} target="_blank" rel="noreferrer">
                {client.name} docs
              </a>
            </div>
            <p className={styles.text}>{client.instructions}</p>
            <pre className={`mono ${styles.snippet}`}>
              <code>{client.code}</code>
            </pre>
            <div className={adminStyles.webhookRow}>{copyButton(client.id, `Copy ${client.name} setup`, client.code)}</div>
            {client.note && <p className={adminStyles.cardHint}>{client.note}</p>}
          </section>
        );
      })}

      <section aria-labelledby="connect-ai-generic" className={adminStyles.card}>
        <h2 id="connect-ai-generic" className={adminStyles.cardTitle}>
          Any MCP client
        </h2>
        <p className={styles.text}>
          Add a remote server using the Streamable HTTP transport, with this URL and header:
        </p>
        <pre className={`mono ${styles.snippet}`}>
          <code>{`URL: ${endpoint}\nAuthorization: Bearer ${TOKEN_PLACEHOLDER}`}</code>
        </pre>
        <p className={adminStyles.cardHint}>
          ChatGPT is not supported yet: its custom connectors only offer OAuth or no authentication, not a token header.
        </p>
      </section>
    </div>
  );
}
