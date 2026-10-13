import { Fragment } from "react";
import { Link } from "react-router";
import type { TaskLink } from "../../api/types.ts";
import styles from "./TaskDetail.module.css";

export function BlocksSection({ blocks, taskHref }: { blocks: TaskLink[]; taskHref: (key: string) => string }) {
  return (
    <section aria-labelledby="blocks-h" className={styles.section}>
      <h2 id="blocks-h" className={styles.sectionTitle}>
        Blocks
      </h2>
      <p className={styles.blocks}>
        {blocks.length === 0
          ? "Nothing depends on this task."
          : blocks.map((task, index) => (
              <Fragment key={task.key}>
                {index > 0 && ", "}
                <Link to={taskHref(task.key)}>
                  <span className="mono">{task.key}</span> {task.title}
                </Link>
              </Fragment>
            ))}
      </p>
    </section>
  );
}
