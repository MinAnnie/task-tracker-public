import { Navigate, Route, Routes } from "react-router";
import { AdminLayout } from "../features/admin/AdminLayout.tsx";
import { MembersContainer } from "../features/admin/MembersContainer.tsx";
import { ProjectSettingsContainer } from "../features/admin/ProjectSettingsContainer.tsx";
import { ProjectsContainer } from "../features/admin/ProjectsContainer.tsx";
import { LoginContainer } from "../features/auth/LoginContainer.tsx";
import { RequireAdmin } from "../features/auth/RequireAdmin.tsx";
import { RequireAuth } from "../features/auth/RequireAuth.tsx";
import { BoardContainer } from "../features/board/BoardContainer.tsx";
import { NewTaskContainer } from "../features/new-task/NewTaskContainer.tsx";
import { HomeRedirect } from "../features/projects/HomeRedirect.tsx";
import { AppShellContainer } from "../features/shell/AppShellContainer.tsx";
import { TaskDetailContainer } from "../features/task-detail/TaskDetailContainer.tsx";
import { paths } from "../lib/paths.ts";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginContainer />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShellContainer />}>
          <Route index element={<HomeRedirect />} />
          <Route path="projects/:slug" element={<BoardContainer />}>
            <Route path="tasks/new" element={<NewTaskContainer />} />
          </Route>
          <Route path="projects/:slug/tasks/:key" element={<TaskDetailContainer />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to={paths.adminMembers} replace />} />
              <Route path="members" element={<MembersContainer />} />
              <Route path="projects" element={<ProjectsContainer />} />
              <Route path="projects/:slug" element={<ProjectSettingsContainer />} />
              <Route path="*" element={<Navigate to={paths.adminMembers} replace />} />
            </Route>
          </Route>
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Route>
    </Routes>
  );
}
