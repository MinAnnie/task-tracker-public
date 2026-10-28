import {
  useCreatePersonalApiToken,
  useCurrentUser,
  usePersonalApiTokens,
  useRevokePersonalApiToken,
} from "../../api/queries.ts";
import adminStyles from "../admin/Admin.module.css";
import { ApiTokensManager } from "../admin/ApiTokensContainer.tsx";
import styles from "./Account.module.css";

const HINT = "Let scripts and AI agents use the tracker as you, without signing in. Works with every project you can access.";
const ADMIN_HINT = `${HINT} Read & write tokens can also create and edit tasks.`;

/** Route `/account/tokens`: the signed-in user's personal API tokens. */
export function AccountTokensContainer() {
  const isAdmin = useCurrentUser().data?.role === "admin";
  return (
    <div className={`${styles.layout} ${adminStyles.page}`}>
      <h1 className={adminStyles.title}>Personal API tokens</h1>
      <ApiTokensManager
        tokens={usePersonalApiTokens()}
        create={useCreatePersonalApiToken()}
        revoke={useRevokePersonalApiToken()}
        usageHint={`curl -H "Authorization: Bearer $TRACKER_API_TOKEN" ${window.location.origin}/api/projects`}
        hint={isAdmin ? ADMIN_HINT : HINT}
        allowWrite={isAdmin}
        readOnlyNote="Personal tokens of members are read only."
      />
    </div>
  );
}
