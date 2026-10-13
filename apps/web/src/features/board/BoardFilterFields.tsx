import { useEffect, useId, useRef, type ReactNode } from "react";
import { TASK_PRIORITIES, type TaskPriority } from "../../api/types.ts";
import { PRIORITY_LABELS } from "../../lib/task-labels.ts";
import type { AssigneeFilter, Availability, BoardFilters } from "./board-model.ts";
import styles from "./BoardFilters.module.css";

export interface StageOption {
  value: string;
  label: string;
}

export interface FilterFieldsProps {
  filters: BoardFilters;
  stages: readonly StageOption[];
  onChange: (filters: BoardFilters) => void;
  /** `toolbar`: one compact row (desktop); `sheet`: stacked lists with large targets (phones). */
  layout: "toolbar" | "sheet";
}

const AVAILABILITY_OPTIONS: { value: Availability; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "ready", label: "Ready to take" },
  { value: "blocked", label: "Blocked by dependencies" },
];

const ASSIGNEE_OPTIONS: { value: AssigneeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
];

const toggle = <T,>(list: readonly T[], value: T) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/** Availability, assignee, priority and stage controls; every change reports the whole filter set. */
export function FilterFields({ filters, stages, onChange, layout }: FilterFieldsProps) {
  const id = useId();
  const set = (changes: Partial<BoardFilters>) => onChange({ ...filters, ...changes });

  const availability = (
    <RadioGroup
      legend="Availability"
      name={`${id}-availability`}
      options={AVAILABILITY_OPTIONS}
      value={filters.availability}
      onChange={(value) => set({ availability: value })}
      layout={layout}
    />
  );
  const assignee = (
    <RadioGroup
      legend="Assignee"
      name={`${id}-assignee`}
      options={ASSIGNEE_OPTIONS}
      value={filters.assignee}
      onChange={(value) => set({ assignee: value })}
      layout={layout}
    />
  );
  const priority = (
    <CheckboxGroup
      legend="Priority"
      options={TASK_PRIORITIES.map((p) => ({
        value: p,
        label: PRIORITY_LABELS[p],
      }))}
      selected={filters.priorities}
      onToggle={(value) => {
        const chosen = toggle(filters.priorities, value as TaskPriority);
        set({ priorities: TASK_PRIORITIES.filter((p) => chosen.includes(p)) });
      }}
      layout={layout}
    />
  );
  const stage = (
    <CheckboxGroup
      legend="Stage"
      options={stages}
      selected={filters.stages}
      onToggle={(value) => set({ stages: toggle(filters.stages, value) })}
      layout={layout}
      emptyText="No task has a stage."
    />
  );

  if (layout === "sheet") {
    return (
      <div className={styles.sheetFields}>
        {availability}
        {assignee}
        {priority}
        {stage}
      </div>
    );
  }
  return (
    <>
      {availability}
      {assignee}
      <Popover label="Priority" count={filters.priorities.length}>
        {priority}
      </Popover>
      <Popover label="Stage" count={filters.stages.length}>
        {stage}
      </Popover>
    </>
  );
}

interface RadioGroupProps<T extends string> {
  legend: string;
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  layout: FilterFieldsProps["layout"];
}

function RadioGroup<T extends string>({ legend, name, options, value, onChange, layout }: RadioGroupProps<T>) {
  return (
    <fieldset role="radiogroup" className={layout === "sheet" ? styles.list : styles.segmented}>
      <legend className={layout === "sheet" ? styles.legend : styles.inlineLegend}>{legend}</legend>
      <div className={layout === "sheet" ? styles.options : styles.segments}>
        {options.map((option) => (
          <label key={option.value} className={layout === "sheet" ? styles.option : styles.segment}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface CheckboxGroupProps {
  legend: string;
  options: readonly StageOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  layout: FilterFieldsProps["layout"];
  emptyText?: string;
}

function CheckboxGroup({ legend, options, selected, onToggle, layout, emptyText }: CheckboxGroupProps) {
  return (
    <fieldset className={layout === "sheet" ? styles.list : styles.menuList}>
      <legend className={layout === "sheet" ? styles.legend : "sr-only"}>{legend}</legend>
      {options.length === 0 && emptyText ? <p className={styles.none}>{emptyText}</p> : null}
      <div className={styles.options}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              type="checkbox"
              value={option.value}
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A compact dropdown for the toolbar, built on <details>: the summary names the
 * filter and how many values are picked. Closes on Escape and on a click outside.
 */
function Popover({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const root = details.current;
      if (root?.open && !root.contains(event.target as Node)) root.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <details
      ref={details}
      className={styles.popover}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !details.current?.open) return;
        event.stopPropagation();
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }}
    >
      <summary className={styles.summary} data-active={count > 0}>
        {label}
        {count > 0 && <span className={styles.badge}>{count}</span>}
        {count > 0 && <span className="sr-only"> selected</span>}
      </summary>
      <div className={styles.menu}>{children}</div>
    </details>
  );
}
