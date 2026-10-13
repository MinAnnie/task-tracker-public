/** Outcomes the server's Discord callback reports as `?discord=<outcome>`. */
const OUTCOMES = ["linked", "already_linked", "cancelled", "failed"] as const;
export type DiscordOutcome = (typeof OUTCOMES)[number];

export const DISCORD_PARAM = "discord";

export interface Notice {
  tone: "success" | "error";
  text: string;
}

export function parseDiscordOutcome(value: string | null): DiscordOutcome | undefined {
  return OUTCOMES.find((outcome) => outcome === value);
}

/** Human copy for an outcome; `username` names the account that was just linked. */
export function discordNotice(outcome: DiscordOutcome, username: string | undefined): Notice {
  switch (outcome) {
    case "linked":
      return { tone: "success", text: username ? `Discord connected as ${username}.` : "Discord connected." };
    case "cancelled":
      return { tone: "success", text: "Discord connection cancelled." };
    case "already_linked":
      return { tone: "error", text: "That Discord account is already connected to another user." };
    case "failed":
      return { tone: "error", text: "Couldn't connect Discord. Try again." };
  }
}

export const DISCONNECT_FAILED: Notice = { tone: "error", text: "Couldn't disconnect Discord. Try again." };
