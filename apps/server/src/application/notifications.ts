import type { TaskPriority } from "../domain/index.ts";

/** A task as mentioned in a notification. */
export interface NotificationTask {
  key: string;
  title: string;
}

/** Where a notification goes: the project's chat channel. */
export interface NotificationTarget {
  channelId: string;
  /** Lowercased project slug, used to link to the task in the web app. */
  projectSlug: string;
}

/**
 * How a notification may mention the assignee: their linked Discord account (a
 * snowflake read from the database, never user input) and whether to ping them.
 * Use cases decide `ping`; it is only `true` when someone else assigned the task.
 */
export interface AssigneeMention {
  assigneeDiscordUserId: string | null;
  ping: boolean;
}

/**
 * Something worth telling a project's channel about. Use cases decide WHAT happened;
 * {@link Notifier} adapters decide how to word and deliver it.
 */
export type NotificationEvent = NotificationTarget &
  (
    | ({
        type: "task_created";
        task: NotificationTask;
        priority: TaskPriority;
        actorLogin: string;
        /** Who the task was created assigned to, if anyone. */
        assigneeLogin: string | null;
      } & AssigneeMention)
    | {
        /**
         * A bulk import created `count` tasks, `explicitKeyCount` of them with keys given by
         * the file and `doneCount` of them already done.
         */
        type: "tasks_imported";
        count: number;
        explicitKeyCount: number;
        doneCount: number;
      }
    | ({
        type: "task_taken";
        task: NotificationTask;
        assigneeLogin: string;
        /** Who assigned it: the assignee when taken, an admin when assigned. */
        actorLogin: string;
      } & AssigneeMention)
    | {
        type: "pull_request";
        action: "opened" | "reopened" | "merged";
        pullRequest: { number: number; title: string; branch: string; url: string; authorLogin: string };
        /** Keys of every task linked to the pull request. */
        taskKeys: string[];
      }
    | {
        /** The task's last pending dependency went away; it is not done. */
        type: "task_unblocked";
        task: NotificationTask;
        assigneeLogin: string | null;
      }
  );

/** Delivers one notification. Implemented by infrastructure adapters (e.g. Discord). */
export interface Notifier {
  notify(event: NotificationEvent): Promise<void>;
}

/**
 * What use cases publish to, once their transaction committed. Never throws and
 * never waits for delivery, so notifications cannot fail or slow down a request.
 */
export interface NotificationPublisher {
  publish(events: readonly NotificationEvent[]): void;
}

/** Publisher that drops everything (notifications disabled). */
export const noNotifications: NotificationPublisher = { publish: () => {} };

/** The project's notification target, or `undefined` when it has no channel configured. */
export function notificationTarget(project: {
  slug: string;
  discordChannelId: string | null;
}): NotificationTarget | undefined {
  return project.discordChannelId === null
    ? undefined
    : { channelId: project.discordChannelId, projectSlug: project.slug };
}
