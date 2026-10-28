import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  BoldIcon,
  BulletListIcon,
  CodeBlockIcon,
  HeadingIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  QuoteIcon,
  TaskListIcon,
} from "./icons.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { applyMarkdownAction, type EditorState, type MarkdownAction } from "./markdown-editor-model.ts";
import styles from "./MarkdownEditor.module.css";

type TextareaProps = Omit<ComponentProps<"textarea">, "id" | "value" | "onChange" | "children" | "ref" | "className">;

export interface MarkdownEditorProps extends TextareaProps {
  /** The textarea's id, for its `<label htmlFor>`; also prefixes the tab and panel ids. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
}

interface Tool {
  action: MarkdownAction;
  label: string;
  icon: ReactNode;
  /** The key that applies it with Ctrl or Cmd. */
  shortcut?: string;
  /** Starts a new group in the toolbar. */
  group?: boolean;
}

const TOOLS: readonly Tool[] = [
  { action: "heading", label: "Heading", icon: <HeadingIcon /> },
  { action: "bold", label: "Bold", icon: <BoldIcon />, shortcut: "B", group: true },
  { action: "italic", label: "Italic", icon: <ItalicIcon />, shortcut: "I" },
  { action: "code", label: "Inline code", icon: <InlineCodeIcon /> },
  { action: "link", label: "Link", icon: <LinkIcon /> },
  { action: "bullet", label: "Bulleted list", icon: <BulletListIcon />, group: true },
  { action: "numbered", label: "Numbered list", icon: <NumberedListIcon /> },
  { action: "task", label: "Task list", icon: <TaskListIcon /> },
  { action: "quote", label: "Quote", icon: <QuoteIcon /> },
  { action: "codeBlock", label: "Code block", icon: <CodeBlockIcon /> },
];

const SHORTCUTS = new Map(TOOLS.flatMap((tool) => (tool.shortcut ? [[tool.shortcut.toLowerCase(), tool.action]] : [])));

const TABS = [
  { id: "write", label: "Write" },
  { id: "preview", label: "Preview" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Index reached from `index` by an arrow, Home or End key in a row of `count` items. */
function rovingIndex(key: string, index: number, count: number): number | undefined {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

/**
 * A controlled textarea for Markdown with a formatting toolbar and a Preview tab. The
 * text stays raw Markdown. Toolbar changes are applied programmatically, so the
 * browser's native undo may not step back through them.
 */
export function MarkdownEditor({ id, value, onChange, ref, onKeyDown, disabled, ...textareaProps }: MarkdownEditorProps) {
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const pending = useRef<EditorState | null>(null);
  const tools = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tab, setTab] = useState<TabId>("write");
  const [activeTool, setActiveTool] = useState(0);
  const [previewHeight, setPreviewHeight] = useState<number>();

  // Once the new text is rendered, put focus and the selection back where the action left them.
  useLayoutEffect(() => {
    const element = textarea.current;
    const next = pending.current;
    if (!element || !next || element.value !== next.value) return;
    pending.current = null;
    element.focus();
    element.setSelectionRange(next.selectionStart, next.selectionEnd);
  });

  function setTextarea(element: HTMLTextAreaElement | null) {
    textarea.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  }

  function apply(action: MarkdownAction) {
    const element = textarea.current;
    if (!element || disabled) return;
    const next = applyMarkdownAction(
      { value, selectionStart: element.selectionStart, selectionEnd: element.selectionEnd },
      action,
    );
    pending.current = next;
    onChange(next.value);
  }

  function onTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const action = SHORTCUTS.get(event.key.toLowerCase());
    if (!action) return;
    event.preventDefault();
    apply(action);
  }

  function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = rovingIndex(event.key, activeTool, TOOLS.length);
    if (next === undefined) return;
    event.preventDefault();
    setActiveTool(next);
    tools.current[next]?.focus();
  }

  function selectTab(next: TabId) {
    if (next === "preview" && tab === "write") setPreviewHeight(textarea.current?.offsetHeight || undefined);
    setTab(next);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.id === tab);
    const next = rovingIndex(event.key, index, TABS.length);
    const target = next === undefined ? undefined : TABS[next];
    if (next === undefined || !target) return;
    event.preventDefault();
    selectTab(target.id);
    tabs.current[next]?.focus();
  }

  const tabId = (t: TabId) => `${id}-${t}-tab`;
  const panelId = (t: TabId) => `${id}-${t}-panel`;

  return (
    <div className={styles.editor}>
      <div className={styles.frame}>
        <div className={styles.bar}>
          <div role="tablist" aria-label="Editor view" className={styles.tabs} onKeyDown={onTabKeyDown}>
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(element) => {
                  tabs.current[i] = element;
                }}
                type="button"
                role="tab"
                id={tabId(t.id)}
                aria-selected={tab === t.id}
                aria-controls={panelId(t.id)}
                tabIndex={tab === t.id ? 0 : -1}
                className={styles.tab}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "write" && (
            <div
              role="toolbar"
              aria-label="Formatting"
              aria-controls={id}
              className={styles.toolbar}
              onKeyDown={onToolbarKeyDown}
            >
              {TOOLS.map((tool, i) => (
                <Fragment key={tool.action}>
                  {tool.group && <span aria-hidden="true" className={styles.separator} />}
                  <button
                    ref={(element) => {
                      tools.current[i] = element;
                    }}
                    type="button"
                    className={styles.tool}
                    aria-label={tool.label}
                    title={tool.shortcut ? `${tool.label} (Ctrl+${tool.shortcut})` : tool.label}
                    aria-keyshortcuts={tool.shortcut ? `Control+${tool.shortcut} Meta+${tool.shortcut}` : undefined}
                    tabIndex={i === activeTool ? 0 : -1}
                    disabled={disabled}
                    // Keeps the textarea focused, and its selection, when clicked.
                    onMouseDown={(event) => event.preventDefault()}
                    onFocus={() => setActiveTool(i)}
                    onClick={() => apply(tool.action)}
                  >
                    {tool.icon}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>

        <div role="tabpanel" id={panelId("write")} aria-labelledby={tabId("write")} hidden={tab !== "write"}>
          <textarea
            {...textareaProps}
            ref={setTextarea}
            id={id}
            value={value}
            disabled={disabled}
            className={styles.textarea}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onTextareaKeyDown}
          />
        </div>
        <div
          role="tabpanel"
          id={panelId("preview")}
          aria-labelledby={tabId("preview")}
          hidden={tab !== "preview"}
          tabIndex={0}
          className={styles.preview}
          style={{ minHeight: previewHeight }}
        >
          {tab === "preview" &&
            (value.trim() === "" ? (
              <p className={styles.empty}>Nothing to preview.</p>
            ) : (
              <MarkdownContent className={styles.previewContent}>{value}</MarkdownContent>
            ))}
        </div>
      </div>
      <span className={styles.hint}>Markdown supported.</span>
    </div>
  );
}
