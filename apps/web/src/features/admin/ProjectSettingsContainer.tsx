import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useAddProjectMember,
  useAddProjectRepository,
  useAdminMembers,
  useAdminProject,
  useDeleteProject,
  useRemoveProjectMember,
  useRemoveProjectRepository,
  useUpdateProject,
} from "../../api/queries.ts";
import type { AdminProjectDetail, ProjectChanges } from "../../api/types.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { paths } from "../../lib/paths.ts";
import { Alert } from "../../ui/Alert.tsx";
import buttons from "../../ui/Button.module.css";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { ChevronLeftIcon } from "../../ui/icons.tsx";
import { StatusMessage } from "../../ui/StatusMessage.tsx";
import styles from "./Admin.module.css";
import { projectFailure } from "./admin-model.ts";
import { ApiTokensContainer } from "./ApiTokensContainer.tsx";
import { GeneralForm } from "./GeneralForm.tsx";
import { ProjectMembersSection } from "./ProjectMembersSection.tsx";
import { RepositoriesSection } from "./RepositoriesSection.tsx";

const failure = (mutation: { isError: boolean; error: unknown }) =>
  mutation.isError ? errorMessage(mutation.error) : undefined;

/** Route `/admin/projects/:slug`. */
export function ProjectSettingsContainer() {
  const slug = useParams().slug ?? "";
  const project = useAdminProject(slug);

  let body;
  if (project.isPending) body = <StatusMessage>Loading project…</StatusMessage>;
  else if (project.isError) body = <Alert tone="error">{errorMessage(project.error)}</Alert>;
  else body = <ProjectSettings key={project.data.slug} project={project.data} />;

  return (
    <div className={styles.page}>
      <div>
        <Link to={paths.adminProjects} className={styles.back}>
          <ChevronLeftIcon />
          All projects
        </Link>
        {project.data && <h1 className={styles.title}>{project.data.name}</h1>}
      </div>
      {body}
    </div>
  );
}

function ProjectSettings({ project }: { project: AdminProjectDetail }) {
  const { slug } = project;
  const navigate = useNavigate();
  const update = useUpdateProject(slug);
  const appMembers = useAdminMembers();
  const addMember = useAddProjectMember(slug);
  const removeMember = useRemoveProjectMember(slug);
  const addRepository = useAddProjectRepository(slug);
  const removeRepository = useRemoveProjectRepository(slug);
  const remove = useDeleteProject(slug);
  const [memberToRemove, setMemberToRemove] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [memberRemoved, setMemberRemoved] = useState(false);
  const membersHeading = useRef<HTMLHeadingElement>(null);

  // After the dialog has closed (and tried to refocus the removed row's button).
  useEffect(() => {
    if (!memberRemoved) return;
    membersHeading.current?.focus();
    setMemberRemoved(false);
  }, [memberRemoved]);

  async function save(changes: ProjectChanges) {
    const saved = await update.mutateAsync(changes);
    if (saved.slug !== slug) navigate(paths.adminProject(saved.slug), { replace: true });
  }

  const inProject = new Set(project.members.map((m) => m.githubLogin));
  const candidates = (appMembers.data?.members ?? [])
    .map((m) => m.githubLogin)
    .filter((login) => !inProject.has(login));

  const closeMemberRemoval = () => {
    setMemberToRemove(undefined);
    removeMember.reset();
  };
  const closeDelete = () => {
    setConfirmingDelete(false);
    remove.reset();
  };

  return (
    <>
      <GeneralForm
        project={project}
        onSave={save}
        saving={update.isPending}
        error={update.isError ? projectFailure(update.error) : undefined}
        onDraftChange={() => {
          if (update.isError) update.reset();
        }}
      />

      <ProjectMembersSection
        members={project.members}
        candidates={candidates}
        onAdd={(login) => addMember.mutateAsync(login)}
        adding={addMember.isPending}
        error={failure(addMember) ?? (appMembers.isError ? errorMessage(appMembers.error) : undefined)}
        onRemove={setMemberToRemove}
        headingRef={membersHeading}
      />

      <RepositoriesSection
        repositories={project.repositories}
        onAdd={(fullName) => addRepository.mutateAsync(fullName)}
        adding={addRepository.isPending}
        onRemove={(fullName) => removeRepository.mutate(fullName)}
        removing={removeRepository.isPending ? removeRepository.variables : undefined}
        error={failure(addRepository) ?? failure(removeRepository)}
        webhookUrl={`${window.location.origin}/webhooks/github`}
      />

      <ApiTokensContainer slug={slug} />

      <section aria-labelledby="delete-h" className={`${styles.card} ${styles.danger}`}>
        <div className={styles.grow}>
          <h2 id="delete-h" className={`${styles.cardTitle} ${styles.dangerTitle}`}>
            Delete project
          </h2>
          <p className={styles.cardHint}>Removes its board, tasks and linked repositories. This can’t be undone.</p>
        </div>
        <button
          type="button"
          className={`${buttons.button} ${buttons.danger}`}
          onClick={() => setConfirmingDelete(true)}
        >
          Delete project…
        </button>
      </section>

      {memberToRemove !== undefined && (
        <ConfirmDialog
          title={`Remove @${memberToRemove} from ${project.name}?`}
          confirmLabel="Remove"
          busyLabel="Removing…"
          busy={removeMember.isPending}
          error={failure(removeMember)}
          onCancel={closeMemberRemoval}
          onConfirm={() =>
            removeMember.mutate(memberToRemove, {
              onSuccess: () => {
                closeMemberRemoval();
                setMemberRemoved(true);
              },
            })
          }
        >
          They’ll lose access to its board, and their open tasks in this project will be unassigned.
        </ConfirmDialog>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          confirmLabel="Delete project"
          busyLabel="Deleting…"
          busy={remove.isPending}
          error={failure(remove)}
          confirmText={slug}
          onCancel={closeDelete}
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate(paths.adminProjects) })}
        >
          This deletes its board, every task, its memberships and linked repositories. It can’t be undone.
        </ConfirmDialog>
      )}
    </>
  );
}
