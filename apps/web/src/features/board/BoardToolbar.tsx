import { useId, useState } from "react";
import buttons from "../../ui/Button.module.css";
import { Dialog } from "../../ui/Dialog.tsx";
import { CloseIcon, SearchIcon } from "../../ui/icons.tsx";
import { activeFilterCount, clearFilters, hasActiveFilters, type BoardFilters } from "./board-model.ts";
import { FilterFields, type AssigneeOption, type StageOption } from "./BoardFilterFields.tsx";
import styles from "./BoardFilters.module.css";

interface BoardToolbarProps {
  filters: BoardFilters;
  stages: readonly StageOption[];
  assignees: readonly AssigneeOption[];
  /** Typing in the search replaces the current history entry; other changes add one. */
  onFiltersChange: (filters: BoardFilters, options?: { replace?: boolean }) => void;
  /** Tasks left after filtering, for the sheet's "Show N tasks". */
  shownCount: number;
}

/**
 * Search plus filters and the sort. Desktop shows the filters in a wrapping row; phones keep the
 * search and move the filters into a sheet behind "Filters (n)".
 */
export function BoardToolbar({ filters, stages, assignees, onFiltersChange, shownCount }: BoardToolbarProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const titleId = useId();
  const count = activeFilterCount(filters);
  const clear = () => onFiltersChange(clearFilters(filters));

  return (
    <div role="search" aria-label="Filter tasks" className={styles.toolbar}>
      <label className={styles.search}>
        <SearchIcon />
        <span className="sr-only">Search tasks</span>
        <input
          type="search"
          placeholder="Search by key or title"
          value={filters.query}
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value }, { replace: true })}
        />
      </label>

      <button
        type="button"
        className={`${buttons.button} ${styles.sheetButton}`}
        aria-haspopup="dialog"
        data-active={count > 0}
        onClick={() => setSheetOpen(true)}
      >
        {count > 0 ? `Filters (${count})` : "Filters"}
      </button>

      <div className={styles.row}>
        <FilterFields
          filters={filters}
          stages={stages}
          assignees={assignees}
          onChange={onFiltersChange}
          layout="toolbar"
        />
        {hasActiveFilters(filters) && (
          <button type="button" className={`${buttons.button} ${styles.clear}`} onClick={clear}>
            Clear filters
          </button>
        )}
      </div>

      {sheetOpen && (
        <Dialog labelledBy={titleId} onClose={() => setSheetOpen(false)}>
          <div className={styles.sheet}>
            <div className={styles.sheetHeader}>
              <h2 id={titleId} className={styles.sheetTitle}>
                Filters
              </h2>
              <button
                type="button"
                className={styles.sheetClose}
                aria-label="Close filters"
                onClick={() => setSheetOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
            <FilterFields
              filters={filters}
              stages={stages}
              assignees={assignees}
              onChange={onFiltersChange}
              layout="sheet"
            />
            <div className={styles.sheetFooter}>
              <button type="button" className={`${buttons.button} ${styles.footerButton}`} onClick={clear}>
                Clear filters
              </button>
              <button
                type="button"
                className={`${buttons.button} ${buttons.primary} ${styles.footerButton}`}
                onClick={() => setSheetOpen(false)}
              >
                {shownCount === 1 ? "Show 1 task" : `Show ${shownCount} tasks`}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
