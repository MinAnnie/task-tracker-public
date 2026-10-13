import { Navigate, useSearchParams } from "react-router";
import { useCurrentUser } from "../../api/queries.ts";
import { LoginPage } from "./LoginPage.tsx";

/** Reads the OAuth outcome from the URL (`?error=not_allowed&login=…`) and skips login when signed in. */
export function LoginContainer() {
  const [params] = useSearchParams();
  const { data: user } = useCurrentUser();

  if (user) return <Navigate to="/" replace />;
  const denied = params.get("error") === "not_allowed";
  return <LoginPage deniedLogin={denied ? (params.get("login") ?? "") : undefined} />;
}
