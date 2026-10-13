/** Largest value of the Postgres `integer` column that stores the next task number. */
const MAX_TASK_NUMBER = 2_147_483_647;
const TRAILING_NUMBER = /-(\d+)$/;
/** The number of a key for sorting: `8` for both `AUTH-08` and `AUTH-08B`. */
const SORT_NUMBER = /-(\d+)[A-Z]?$/i;

export function formatTaskKey(prefix: string, taskNumber: number): string {
  return `${prefix}-${taskNumber}`;
}

/**
 * Number for the next generated key `<prefix>-<n>` of a project.
 *
 * Projects may hold imported tasks with arbitrary keys, so the stored counter alone
 * could collide with them: n is the larger of the counter and one past the highest
 * numeric suffix among keys of the form `<prefix>-<digits>`. The prefix matches
 * case-insensitively, so a generated key never differs from an existing one only by
 * case. Suffixes too large for the counter to move past them are ignored; the
 * generated number is then smaller than them and cannot collide either.
 *
 * @param prefix the project's (uppercased, alphanumeric) task key prefix.
 */
export function nextTaskKeyNumber(
  prefix: string,
  nextTaskNumber: number,
  existingKeys: readonly string[],
): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let next = nextTaskNumber;
  for (const key of existingKeys) {
    const digits = pattern.exec(key)?.[1];
    if (digits === undefined) continue;
    const value = Number(digits);
    if (value + 2 <= MAX_TASK_NUMBER && value + 1 > next) next = value + 1;
  }
  return next;
}

/** The number after the last hyphen of a key (`14` in `RF-14`), or `undefined` when there is none. */
export function taskKeyNumber(key: string): number | undefined {
  const digits = TRAILING_NUMBER.exec(key)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

const sortNumber = (key: string) => {
  const digits = SORT_NUMBER.exec(key)?.[1];
  return digits === undefined ? undefined : Number(digits);
};

/**
 * Sort comparator: keys by trailing number (ignoring a letter suffix, so `AUTH-08B` follows
 * `AUTH-08`), keys without one last; ties by text.
 */
export function compareTaskKeys(a: string, b: string): number {
  const left = sortNumber(a);
  const right = sortNumber(b);
  if (left !== right) {
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
