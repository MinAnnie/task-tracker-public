import { NavLink, Outlet } from "react-router";
import { paths } from "../../lib/paths.ts";
import styles from "./Admin.module.css";

/** Layout route of the admin area: section nav (side on desktop, tabs on phones) and the section. */
export function AdminLayout() {
  const linkClass = ({ isActive }: { isActive: boolean }) => `${styles.sectionLink} ${isActive ? styles.active : ""}`;
  return (
    <div className={styles.layout}>
      <nav aria-label="Admin sections" className={styles.sections}>
        <NavLink to={paths.adminMembers} className={linkClass}>
          Members
        </NavLink>
        <NavLink to={paths.adminProjects} className={linkClass}>
          Projects
        </NavLink>
      </nav>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
