import { useAdminStages, useCreateStage, useDeleteStage, useUpdateStage } from "../../api/queries.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { StagesSection } from "./StagesSection.tsx";

const failure = (mutation: { isError: boolean; error: unknown }) =>
  mutation.isError ? errorMessage(mutation.error) : undefined;

/** The project's stages: list, add, rename, reorder and delete. */
export function StagesContainer({ slug }: { slug: string }) {
  const stages = useAdminStages(slug);
  const create = useCreateStage(slug);
  const update = useUpdateStage(slug);
  const remove = useDeleteStage(slug);

  /** Only the latest write's error is shown. */
  const resetErrors = () => {
    create.reset();
    update.reset();
    remove.reset();
  };

  return (
    <StagesSection
      stages={stages.data}
      loadError={stages.isError ? errorMessage(stages.error) : undefined}
      onAdd={(name) => {
        resetErrors();
        return create.mutateAsync(name);
      }}
      adding={create.isPending}
      onRename={(stage, name) => {
        resetErrors();
        return update.mutateAsync({ id: stage.id, changes: { name } });
      }}
      onMove={(stage, position) => {
        resetErrors();
        update.mutate({ id: stage.id, changes: { position } });
      }}
      onDelete={(stage) => {
        resetErrors();
        remove.mutate(stage.id);
      }}
      busy={update.isPending || remove.isPending}
      error={failure(create) ?? failure(update) ?? failure(remove)}
    />
  );
}
