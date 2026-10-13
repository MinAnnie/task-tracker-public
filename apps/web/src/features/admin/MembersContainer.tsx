import { useEffect, useRef, useState } from "react";
import { useAddMember, useAdminMembers, useRemoveMember } from "../../api/queries.ts";
import { errorMessage } from "../../lib/error-messages.ts";
import { Alert } from "../../ui/Alert.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { StatusMessage } from "../../ui/StatusMessage.tsx";
import { MembersView } from "./MembersView.tsx";

/** Route `/admin/members`. */
export function MembersContainer() {
  const overview = useAdminMembers();
  const add = useAddMember();
  const remove = useRemoveMember();
  const [removing, setRemoving] = useState<string>();
  const [removed, setRemoved] = useState(false);
  const membersHeading = useRef<HTMLHeadingElement>(null);

  // After the dialog has closed (and tried to refocus the removed row's button).
  useEffect(() => {
    if (!removed) return;
    membersHeading.current?.focus();
    setRemoved(false);
  }, [removed]);

  if (overview.isPending) return <StatusMessage>Loading members…</StatusMessage>;
  if (overview.isError) return <Alert tone="error">{errorMessage(overview.error)}</Alert>;

  const closeRemoval = () => {
    setRemoving(undefined);
    remove.reset();
  };

  return (
    <>
      <MembersView
        admins={overview.data.admins}
        members={overview.data.members}
        onAdd={(login) => add.mutateAsync(login)}
        adding={add.isPending}
        addError={add.isError ? errorMessage(add.error) : undefined}
        onDraftChange={() => {
          if (add.isError) add.reset();
        }}
        onRemove={setRemoving}
        membersHeadingRef={membersHeading}
      />
      {removing !== undefined && (
        <ConfirmDialog
          title={`Remove @${removing}?`}
          confirmLabel="Remove"
          busyLabel="Removing…"
          busy={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : undefined}
          onCancel={closeRemoval}
          onConfirm={() =>
            remove.mutate(removing, {
              onSuccess: () => {
                closeRemoval();
                setRemoved(true);
              },
            })
          }
        >
          They’ll be signed out and their open tasks unassigned.
        </ConfirmDialog>
      )}
    </>
  );
}
