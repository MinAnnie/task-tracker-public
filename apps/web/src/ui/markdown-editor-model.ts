/** A textarea's text and selection, the input and output of every formatting action. */
export interface EditorState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type InlineFormat = "bold" | "italic" | "code";
export type LineFormat = "heading" | "bullet" | "numbered" | "task" | "quote";
export type MarkdownAction = InlineFormat | LineFormat | "codeBlock" | "link";

const INLINE: Record<InlineFormat, { marker: string; placeholder: string }> = {
  bold: { marker: "**", placeholder: "bold text" },
  italic: { marker: "_", placeholder: "italic text" },
  code: { marker: "`", placeholder: "code" },
};

const TASK_PREFIX = /^- \[[ xX]\] /;
const LIST_PREFIX = /^(?:- \[[ xX]\] |- |\d+\. )/;
const HEADING_PREFIX = /^#{1,6} /;

/**
 * How each line format is recognised, which prefix it replaces when applied (lists
 * switch kind, headings switch level), and the prefix it adds to the n-th line.
 */
const LINE: Record<LineFormat, { has: RegExp; replaces: RegExp; prefix: (n: number) => string }> = {
  heading: { has: /^## /, replaces: HEADING_PREFIX, prefix: () => "## " },
  bullet: { has: /^- (?!\[[ xX]\] )/, replaces: LIST_PREFIX, prefix: () => "- " },
  numbered: { has: /^\d+\. /, replaces: LIST_PREFIX, prefix: (n) => `${n}. ` },
  task: { has: TASK_PREFIX, replaces: LIST_PREFIX, prefix: () => "- [ ] " },
  quote: { has: /^> /, replaces: /^> /, prefix: () => "> " },
};

const FENCE = "```";

/** Applies a toolbar action to the text, returning the new text and what to select. */
export function applyMarkdownAction(state: EditorState, action: MarkdownAction): EditorState {
  if (action === "codeBlock") return toggleCodeBlock(state);
  if (action === "link") return insertLink(state);
  if (action in INLINE) return toggleInline(state, action as InlineFormat);
  return toggleLinePrefix(state, action as LineFormat);
}

/** Wraps the selection in `**`, `_` or a backtick, or unwraps it when it already is. */
export function toggleInline(state: EditorState, format: InlineFormat): EditorState {
  const { marker, placeholder } = INLINE[format];
  const { value } = state;
  const selected = value.slice(state.selectionStart, state.selectionEnd);
  // Markers hugging spaces don't format, so spaces at either end stay outside.
  const start = state.selectionStart + (selected.length - selected.trimStart().length);
  const end = state.selectionEnd - (selected.length - selected.trimEnd().length);

  if (start >= end) {
    const at = state.selectionStart;
    const inserted = marker + placeholder + marker;
    return select(value.slice(0, at) + inserted + value.slice(at), at + marker.length, at + marker.length + placeholder.length);
  }

  const text = value.slice(start, end);
  if (text.length >= marker.length * 2 && text.startsWith(marker) && text.endsWith(marker)) {
    const inner = text.slice(marker.length, -marker.length);
    return select(value.slice(0, start) + inner + value.slice(end), start, start + inner.length);
  }
  if (value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker) {
    const before = value.slice(0, start - marker.length);
    return select(before + text + value.slice(end + marker.length), before.length, before.length + text.length);
  }
  return select(value.slice(0, start) + marker + text + marker + value.slice(end), start + marker.length, end + marker.length);
}

/**
 * Adds the prefix to every line the selection touches, or removes it when they all
 * have it. Blank lines in a multi-line selection are left alone.
 */
export function toggleLinePrefix(state: EditorState, format: LineFormat): EditorState {
  const { has, replaces, prefix } = LINE[format];
  const { lineStart, lineEnd } = touchedLines(state);
  const lines = state.value.slice(lineStart, lineEnd).split("\n");
  const targets = lines.some((line) => line.trim() !== "") ? lines.map((line) => line.trim() !== "") : lines.map(() => true);
  const remove = lines.every((line, i) => !targets[i] || has.test(line));

  let n = 0;
  const next = lines.map((line, i) => {
    if (!targets[i]) return line;
    if (remove) return line.replace(has, "");
    n += 1;
    return prefix(n) + line.replace(replaces, "");
  });
  const block = next.join("\n");
  const value = state.value.slice(0, lineStart) + block + state.value.slice(lineEnd);

  if (state.selectionStart === state.selectionEnd) {
    const caret = Math.max(lineStart, state.selectionStart + (next[0] ?? "").length - (lines[0] ?? "").length);
    return select(value, caret, caret);
  }
  return select(value, lineStart, lineStart + block.length);
}

/** Puts ``` fences on their own lines around the touched lines, or removes them. */
export function toggleCodeBlock(state: EditorState): EditorState {
  const { lineStart, lineEnd } = touchedLines(state);
  const block = state.value.slice(lineStart, lineEnd);
  const before = state.value.slice(0, lineStart);
  const after = state.value.slice(lineEnd);

  const open = `${FENCE}\n`;
  const close = `\n${FENCE}`;
  if (block.length >= open.length + close.length && block.startsWith(open) && block.endsWith(close)) {
    const inner = block.slice(open.length, -close.length);
    return select(before + inner + after, lineStart, lineStart + inner.length);
  }
  const start = lineStart + open.length;
  return select(before + open + block + close + after, start, start + block.length);
}

/** Turns the selection into `[selection](url)` with `url` selected, or inserts `[link text](url)`. */
export function insertLink(state: EditorState): EditorState {
  const { value, selectionStart, selectionEnd } = state;
  const text = value.slice(selectionStart, selectionEnd);
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  if (text === "") {
    const placeholder = "link text";
    const start = selectionStart + 1;
    return select(`${before}[${placeholder}](url)${after}`, start, start + placeholder.length);
  }
  const urlStart = selectionStart + text.length + 3;
  return select(`${before}[${text}](url)${after}`, urlStart, urlStart + "url".length);
}

/** The start and end of the whole lines the selection touches. */
function touchedLines({ value, selectionStart, selectionEnd }: EditorState) {
  // A selection ending right after a newline doesn't reach into the next line.
  const end = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const newline = value.indexOf("\n", end);
  return { lineStart, lineEnd: newline === -1 ? value.length : newline };
}

const select = (value: string, selectionStart: number, selectionEnd: number): EditorState => ({
  value,
  selectionStart,
  selectionEnd,
});
