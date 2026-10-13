import { Navigate, Outlet } from "react-router";
import { useCurrentUser } from "../../api/queries.ts";
import { Alert } from "../../ui/Alert.tsx";
import { StatusMessage } from "../../ui/StatusMessage.tsx";
import { errorMessage } from "../../lib/error-messages.ts";
import styles from "./RequireAuth.module.css";

/** Layout route: renders its children for signed-in users, sends everyone else to login. */
export function RequireAuth() {
  const { data: user, isPending, error } = useCurrentUser();

  if (isPending) return <StatusMessage>Loading…</StatusMessage>;
  if (error) {
    return (
      <div className={styles.error}>
        <Alert tone="error">{errorMessage(error)}</Alert>
      </div>
    );
  }
  if (user === null) return <Navigate to="/login" replace />;
  return <Outlet />;
}
