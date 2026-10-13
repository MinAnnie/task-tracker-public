/** Discord snowflakes are unsigned 64-bit integers: 17 to 20 ASCII digits in practice. */
const DISCORD_USER_ID = /^[0-9]{17,20}$/;

/** Whether `value` is a Discord user id (a snowflake) that is safe to render as a `<@id>` mention. */
export function isDiscordUserId(value: unknown): value is string {
  return typeof value === "string" && DISCORD_USER_ID.test(value);
}
