import { mcpEndpointUrl } from "./connect-ai-model.ts";
import { ConnectAiPage } from "./ConnectAiPage.tsx";

/** Route `/account/ai`. The API serves `/mcp` on the app's own origin. */
export function ConnectAiContainer() {
  return <ConnectAiPage endpoint={mcpEndpointUrl(window.location.origin)} />;
}
