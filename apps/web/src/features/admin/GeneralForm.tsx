import { useRef, useState, type FormEvent } from "react";
import type { AdminProject, ProjectChanges } from "../../api/types.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";
import {
  fieldErrors,
  toProjectInput,
  validateProjectValues,
  type ProjectErrors,
  type ProjectFailure,
  type ProjectValues,
} from "./admin-model.ts";
import { TextField } from "./TextField.tsx";

export interface GeneralFormProps {
  project: AdminProject;
  /** Resolves once saved; rejects (keeping the values) when the server refuses. */
  onSave: (changes: ProjectChanges) => Promise<unknown>;
  saving: boolean;
  /** Why the last save failed; shown on its field when one caused it. */
  error?: ProjectFailure;
  /** Called on every edit and submit, so a stale server error goes away. */
  onDraftChange: () => void;
}

const FIELD_ORDER: (keyof ProjectValues)[] = ["name", "slug", "taskKeyPrefix", "discordChannelId"];

const valuesOf = (project: AdminProject): ProjectValues => ({
  name: project.name,
  slug: project.slug,
  taskKeyPrefix: project.taskKeyPrefix,
  discordChannelId: project.discordChannelId ?? "",
});

/** Only the fields that differ from the saved project. */
function changesFrom(project: AdminProject, values: ProjectValues): ProjectChanges {
  const next = toProjectInput(values);
  const changes: ProjectChanges = {};
  if (next.name !== project.name) changes.name = next.name;
  if (next.slug !== project.slug) changes.slug = next.slug;
  if (next.taskKeyPrefix !== project.taskKeyPrefix) changes.taskKeyPrefix = next.taskKeyPrefix;
  if (next.discordChannelId !== project.discordChannelId) changes.discordChannelId = next.discordChannelId;
  return changes;
}

export function GeneralForm({ project, onSave, saving, error, onDraftChange }: GeneralFormProps) {
  const [values, setValues] = useState<ProjectValues>(() => valuesOf(project));
  const [clientErrors, setErrors] = useState<ProjectErrors>({});
  const errors = fieldErrors(clientErrors, error);
  const [notice, setNotice] = useState<string>();
  const refs = {
    name: useRef<HTMLInputElement>(null),
    slug: useRef<HTMLInputElement>(null),
    taskKeyPrefix: useRef<HTMLInputElement>(null),
    discordChannelId: useRef<HTMLInputElement>(null),
  };

  const set = (field: keyof ProjectValues) => (value: string) => {
    setNotice(undefined);
    onDraftChange();
    setValues((current) => ({ ...current, [field]: field === "taskKeyPrefix" ? value.toUpperCase() : value }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(undefined);
    onDraftChange();
    const found = validateProjectValues(values);
    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }
    const changes = changesFrom(project, values);
    if (Object.keys(changes).length === 0) {
      setNotice("Nothing to save.");
      return;
    }
    try {
      await onSave(changes);
      setNotice("Saved.");
    } catch {
      // The container shows the server's reason.
    }
  }

  const prefix = values.taskKeyPrefix || project.taskKeyPrefix;
  return (
    <form aria-labelledby="general-h" className={styles.card} onSubmit={submit} noValidate>
      <h2 id="general-h" className={styles.cardTitle}>
        General
      </h2>
      {error && !error.field && <Alert tone="error">{error.message}</Alert>}
      <div className={styles.fieldGrid}>
        <TextField label="Name" value={values.name} onChange={set("name")} error={errors.name} inputRef={refs.name} />
        <TextField
          label="Short key"
          mono
          value={values.slug}
          onChange={set("slug")}
          help="Used in links. Changing it changes the board’s URL."
          error={errors.slug}
          inputRef={refs.slug}
          autoCapitalize="off"
          spellCheck={false}
        />
        <TextField
          label="Task key prefix"
          mono
          value={values.taskKeyPrefix}
          onChange={set("taskKeyPrefix")}
          help={`New tasks get keys like ${prefix}-14. Mention the key in a PR title or branch to link it.`}
          error={errors.taskKeyPrefix}
          inputRef={refs.taskKeyPrefix}
          autoCapitalize="characters"
          spellCheck={false}
        />
        <TextField
          label="Discord channel ID"
          mono
          inputMode="numeric"
          value={values.discordChannelId}
          onChange={set("discordChannelId")}
          help="Where the bot posts updates. In Discord: right-click the channel › Copy Channel ID. Leave it empty for none."
          error={errors.discordChannelId}
          inputRef={refs.discordChannelId}
        />
      </div>
      <div className={styles.formActions}>
        <button type="submit" className={`${buttons.button} ${buttons.primary}`} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <span role="status" className={styles.notice}>
          {notice}
        </span>
      </div>
    </form>
  );
}
