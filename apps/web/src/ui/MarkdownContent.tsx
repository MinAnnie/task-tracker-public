import type { Ref } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownContent.module.css";

export interface MarkdownContentProps {
  /** Markdown source; GitHub-flavoured (tables, task lists, strikethrough, autolinks). */
  children: string;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}

/** Links in rendered Markdown leave the app in a new tab. */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

const REMARK_PLUGINS = [remarkGfm];

/** Renders user-written Markdown without raw HTML; react-markdown also drops unsafe link protocols. */
export function MarkdownContent({ children, ref, className }: MarkdownContentProps) {
  return (
    <div ref={ref} className={className ? `${styles.markdown} ${className}` : styles.markdown}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {children}
      </Markdown>
    </div>
  );
}
