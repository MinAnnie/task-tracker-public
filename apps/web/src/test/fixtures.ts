import type {
  AdminProjectDetail,
  AdminProjectSummary,
  BoardTask,
  CurrentUser,
  MembersOverview,
  Project,
  TaskDetail,
} from "../api/types.ts";

export const me: CurrentUser = {
  id: 1,
  githubLogin: "annamiller",
  name: "Anna Miller",
  avatarUrl: null,
  role: "member",
  discord: null,
  discordLinkingEnabled: false,
};

export const admin: CurrentUser = { ...me, id: 2, githubLogin: "boss", name: "The Boss", role: "admin" };

export const projects: Project[] = [
  { id: 1, slug: "app", name: "Acme App", taskKeyPrefix: "RF" },
  { id: 2, slug: "landing", name: "Acme Landing", taskKeyPrefix: "LD" },
];

export function boardTask(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    key: "RF-1",
    title: "A task",
    status: "todo",
    priority: "medium",
    stage: null,
    assignee: null,
    pullRequests: [],
    dependsOn: [],
    pendingDependencies: [],
    canTake: true,
    ...overrides,
  };
}

export function taskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    key: "RF-14",
    title: "Discord bot: post merged PRs",
    description: "Post a message when a linked pull request is merged.",
    status: "todo",
    priority: "high",
    stage: "Sprint 3",
    assignee: null,
    canTake: true,
    pendingDependencies: [],
    dependsOn: [],
    blocks: [],
    pullRequests: [],
    ...overrides,
  };
}

export const membersOverview: MembersOverview = {
  admins: ["boss"],
  members: [
    { githubLogin: "juanperez", createdAt: "2026-10-09T15:00:00.000Z", addedBy: "boss" },
    { githubLogin: "maria-dev", createdAt: "2026-10-08T15:00:00.000Z", addedBy: null },
  ],
};

export const adminProjects: AdminProjectSummary[] = [
  {
    id: 1,
    slug: "app",
    name: "Acme App",
    taskKeyPrefix: "RF",
    discordChannelId: "1234567890123456789",
    createdAt: "2026-10-01T15:00:00.000Z",
    repositoryCount: 2,
    taskCount: 7,
    memberCount: 1,
  },
  {
    id: 2,
    slug: "landing",
    name: "Acme Landing",
    taskKeyPrefix: "LD",
    discordChannelId: null,
    createdAt: "2026-10-02T15:00:00.000Z",
    repositoryCount: 1,
    taskCount: 0,
    memberCount: 0,
  },
];

export function adminProjectDetail(overrides: Partial<AdminProjectDetail> = {}): AdminProjectDetail {
  return {
    id: 1,
    slug: "app",
    name: "Acme App",
    taskKeyPrefix: "RF",
    discordChannelId: "1234567890123456789",
    createdAt: "2026-10-01T15:00:00.000Z",
    repositories: [{ fullName: "acme/app-web", githubInstallationId: null }],
    members: [{ githubLogin: "juanperez", createdAt: "2026-10-09T15:00:00.000Z" }],
    ...overrides,
  };
}
