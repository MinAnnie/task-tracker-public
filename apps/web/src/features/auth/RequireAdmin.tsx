import { Navigate, Outlet } from "react-router";
import { useCurrentUser } from "../../api/queries.ts";

/** Layout route for admin screens; members go back home. Runs inside {@link RequireAuth}. */
export function RequireAdmin() {
  const user = useCurrentUser().data;
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}
