import type { TaskPriority } from "../api/types.ts";

const BARS: Record<TaskPriority, number> = { urgent: 3, high: 3, medium: 2, low: 1 };

/** Signal-bars icon; decorative, so always render the priority label next to it. */
export function PriorityIcon({ priority, size = 14 }: { priority: TaskPriority; size?: number }) {
  const fill = `var(--priority-${priority})`;
  const bars = BARS[priority];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1" y="10" width="3" height="5" rx="1" fill={fill} />
      <rect x="6.5" y="6" width="3" height="9" rx="1" fill={fill} opacity={bars >= 2 ? 1 : 0.25} />
      <rect x="12" y="2" width="3" height="13" rx="1" fill={fill} opacity={bars >= 3 ? 1 : 0.25} />
    </svg>
  );
}
