import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { AdminProjectSummary, NewProjectInput } from "../../api/types.ts";
import { paths } from "../../lib/paths.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import styles from "./Admin.module.css";
import {
  countLabel,
  EMPTY_PROJECT,
  fieldErrors,
  slugFromName,
  suggestTaskKeyPrefix,
  toProjectInput,
  validateProjectValues,
  type ProjectErrors,
  type ProjectFailure,
  type ProjectValues,
} from "./admin-model.ts";
import { TextField } from "./TextField.tsx";

export interface ProjectsViewProps {
  projects: AdminProjectSummary[];
  /** Resolves once created; rejects (keeping the values) when the server refuses. */
  onCreate: (input: NewProjectInput) => Promise<unknown>;
  creating: boolean;
  /** Why the last creation failed; shown on its field when one caused it. */
  createError?: ProjectFailure;
  /** Called on every edit and submit, so a stale server error goes away. */
  onDraftChange: () => void;
}

export function ProjectsView(props: ProjectsViewProps) {
  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.title}>Projects</h1>
        <p className={styles.lede}>Each project has its own board, GitHub repositories and Discord channel.</p>
      </div>
      <NewProjectForm {...props} />
      {props.projects.length === 0 ? (
        <p className={styles.empty}>No projects yet. Create the first one above.</p>
      ) : (
        <ul className={styles.projectGrid}>
          {props.projects.map((project) => (
            <li key={project.slug}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FIELD_ORDER: (keyof ProjectValues)[] = ["name", "slug", "taskKeyPrefix", "discordChannelId"];

function NewProjectForm({ onCreate, creating, createError, onDraftChange }: ProjectsViewProps) {
  const [values, setValues] = useState<ProjectValues>(EMPTY_PROJECT);
  const [clientErrors, setErrors] = useState<ProjectErrors>({});
  const errors = fieldErrors(clientErrors, createError);
  const edit = (change: (current: ProjectValues) => ProjectValues) => {
    onDraftChange();
    setValues(change);
  };
  // The short key and prefix follow the name until the user types their own.
  const [slugEdited, setSlugEdited] = useState(false);
  const [prefixEdited, setPrefixEdited] = useState(false);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    slug: useRef<HTMLInputElement>(null),
    taskKeyPrefix: useRef<HTMLInputElement>(null),
    discordChannelId: useRef<HTMLInputElement>(null),
  };

  const setName = (name: string) =>
    edit((current) => ({
      ...current,
      name,
      slug: slugEdited ? current.slug : slugFromName(name),
      taskKeyPrefix: prefixEdited ? current.taskKeyPrefix : suggestTaskKeyPrefix(name),
    }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    onDraftChange();
    const found = validateProjectValues(values);
    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }
    try {
      await onCreate(toProjectInput(values));
    } catch {
      // The container shows the server's reason.
    }
  }

  return (
    <form aria-labelledby="new-project-h" className={styles.card} onSubmit={submit} noValidate>
      <h2 id="new-project-h" className={styles.cardTitle}>
        New project
      </h2>
      {createError && !createError.field && <Alert tone="error">{createError.message}</Alert>}
      <div className={styles.fieldGrid}>
        <TextField
          label="Name"
          value={values.name}
          onChange={setName}
          placeholder="Acme Mobile"
          error={errors.name}
          inputRef={refs.name}
        />
        <TextField
          label="Short key"
          mono
          value={values.slug}
          onChange={(slug) => {
            setSlugEdited(slug !== "");
            edit((current) => ({ ...current, slug }));
          }}
          placeholder="acme-mobile"
          help="Lowercase letters, numbers and hyphens. Filled in from the name; used in links."
          error={errors.slug}
          inputRef={refs.slug}
          autoCapitalize="off"
          spellCheck={false}
        />
        <TextField
          label="Task key prefix"
          mono
          value={values.taskKeyPrefix}
          onChange={(prefix) => {
            setPrefixEdited(prefix !== "");
            edit((current) => ({ ...current, taskKeyPrefix: prefix.toUpperCase() }));
          }}
          placeholder="AM"
          help={`Tasks get keys like ${values.taskKeyPrefix || "AM"}-1.`}
          error={errors.taskKeyPrefix}
          inputRef={refs.taskKeyPrefix}
          autoCapitalize="characters"
          spellCheck={false}
        />
        <TextField
          label="Discord channel ID"
          optional
          mono
          inputMode="numeric"
          value={values.discordChannelId}
          onChange={(discordChannelId) => edit((current) => ({ ...current, discordChannelId }))}
          error={errors.discordChannelId}
          inputRef={refs.discordChannelId}
        />
      </div>
      <div>
        <button type="submit" className={`${buttons.button} ${buttons.primary}`} disabled={creating}>
          {creating ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

function ProjectCard({ project }: { project: AdminProjectSummary }) {
  return (
    <Link to={paths.adminProject(project.slug)} className={styles.projectCard}>
      <span className={styles.projectName}>
        <span className={styles.projectTitle}>{project.name}</span>
        <span className={`mono ${styles.projectSlug}`}>{project.slug}</span>
      </span>
      <span className={styles.chips}>
        <span className={styles.chip}>{countLabel(project.repositoryCount, "repository", "repositories")}</span>
        <span className={styles.chip}>{countLabel(project.taskCount, "task")}</span>
        <span className={styles.chip}>{countLabel(project.memberCount, "member")}</span>
        {project.discordChannelId ? (
          <span className={`${styles.chip} ${styles.chipOk}`}>Discord linked</span>
        ) : (
          <span className={`${styles.chip} ${styles.chipWarn}`}>No Discord channel</span>
        )}
      </span>
    </Link>
  );
}
