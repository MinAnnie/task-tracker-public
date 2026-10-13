import { Fragment } from "react";
import { Link } from "react-router";
import { Alert } from "../../ui/Alert.tsx";
import { LockIcon } from "../../ui/icons.tsx";

interface WaitingBannerProps {
  pending: readonly string[];
  taskHref: (key: string) => string;
}

/** Explains why an unassigned task can't be taken yet. */
export function WaitingBanner({ pending, taskHref }: WaitingBannerProps) {
  const one = pending.length === 1;
  return (
    <Alert tone="warning" role="status" title="Can’t be taken yet" icon={<LockIcon size={20} />}>
      It depends on{" "}
      {pending.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && (index === pending.length - 1 ? " and " : ", ")}
          <Link to={taskHref(key)}>{key}</Link>
        </Fragment>
      ))}
      , which {one ? "isn’t" : "aren’t"} done. It unlocks automatically when {one ? pending[0] : "they"}{" "}
      {one ? "is" : "are"} merged or marked done.
    </Alert>
  );
}
