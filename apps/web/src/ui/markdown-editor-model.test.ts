import { describe, expect, it } from "vitest";
import { applyMarkdownAction, type EditorState } from "./markdown-editor-model.ts";

/** Builds a state from text where `[` and `]` mark the selection (`|` marks a collapsed one). */
function state(marked: string): EditorState {
  const caret = marked.indexOf("|");
  if (caret !== -1) {
    return { value: marked.slice(0, caret) + marked.slice(caret + 1), selectionStart: caret, selectionEnd: caret };
  }
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), selectionStart: start, selectionEnd: end };
}

/** The inverse of `state`, so results read like their inputs. */
function show({ value, selectionStart, selectionEnd }: EditorState): string {
  if (selectionStart === selectionEnd) return `${value.slice(0, selectionStart)}|${value.slice(selectionStart)}`;
  return `${value.slice(0, selectionStart)}[${value.slice(selectionStart, selectionEnd)}]${value.slice(selectionEnd)}`;
}

describe("inline formats", () => {
  it("wraps the selection, keeping it selected", () => {
    expect(show(applyMarkdownAction(state("Ship [it] now"), "bold"))).toBe("Ship **[it]** now");
    expect(show(applyMarkdownAction(state("Ship [it] now"), "italic"))).toBe("Ship _[it]_ now");
    expect(show(applyMarkdownAction(state("Run [pnpm test]"), "code"))).toBe("Run `[pnpm test]`");
  });

  it("inserts the markers around a selected placeholder when nothing is selected", () => {
    expect(show(applyMarkdownAction(state("Ship |"), "bold"))).toBe("Ship **[bold text]**");
    expect(show(applyMarkdownAction(state("|"), "italic"))).toBe("_[italic text]_");
    expect(show(applyMarkdownAction(state("Run |"), "code"))).toBe("Run `[code]`");
  });

  it("toggles off when the selection is already wrapped", () => {
    expect(show(applyMarkdownAction(state("Ship **[it]** now"), "bold"))).toBe("Ship [it] now");
    expect(show(applyMarkdownAction(state("Ship [**it**] now"), "bold"))).toBe("Ship [it] now");
    expect(show(applyMarkdownAction(state("Ship _[it]_ now"), "italic"))).toBe("Ship [it] now");
    expect(show(applyMarkdownAction(state("Run `[pnpm test]`"), "code"))).toBe("Run [pnpm test]");
  });

  it("keeps surrounding spaces outside the markers", () => {
    expect(show(applyMarkdownAction(state("Ship[ it ]now"), "bold"))).toBe("Ship **[it]** now");
  });

  it("treats a whitespace-only selection like no selection", () => {
    expect(show(applyMarkdownAction(state("a[ ]b"), "bold"))).toBe("a**[bold text]** b");
  });
});

describe("line prefixes", () => {
  it("prefixes the line the caret is on, moving the caret with the text", () => {
    expect(show(applyMarkdownAction(state("Intro\nGo|al\nEnd"), "heading"))).toBe("Intro\n## Go|al\nEnd");
    expect(show(applyMarkdownAction(state("Buy |milk"), "bullet"))).toBe("- Buy |milk");
    expect(show(applyMarkdownAction(state("Read |"), "task"))).toBe("- [ ] Read |");
    expect(show(applyMarkdownAction(state("|Said so"), "quote"))).toBe("> |Said so");
  });

  it("prefixes an empty line", () => {
    expect(show(applyMarkdownAction(state("|"), "bullet"))).toBe("- |");
  });

  it("prefixes every line the selection touches and selects them", () => {
    expect(show(applyMarkdownAction(state("Intro\nO[ne\nTw]o\nEnd"), "bullet"))).toBe("Intro\n[- One\n- Two]\nEnd");
    expect(show(applyMarkdownAction(state("[One\nTwo]"), "quote"))).toBe("[> One\n> Two]");
  });

  it("numbers lines in order, skipping blank ones", () => {
    expect(show(applyMarkdownAction(state("[One\n\nTwo\nThree]"), "numbered"))).toBe("[1. One\n\n2. Two\n3. Three]");
  });

  it("ignores the line after a selection that ends at its start", () => {
    expect(show(applyMarkdownAction(state("[One\n]Two"), "bullet"))).toBe("[- One]\nTwo");
  });

  it("toggles off when every touched line already has the prefix", () => {
    expect(show(applyMarkdownAction(state("[- One\n- Two]"), "bullet"))).toBe("[One\nTwo]");
    expect(show(applyMarkdownAction(state("[1. One\n2. Two]"), "numbered"))).toBe("[One\nTwo]");
    expect(show(applyMarkdownAction(state("- [ ] Re|ad"), "task"))).toBe("Re|ad");
    expect(show(applyMarkdownAction(state("## Go|al"), "heading"))).toBe("Go|al");
    expect(show(applyMarkdownAction(state("> |Said"), "quote"))).toBe("|Said");
  });

  it("adds the prefix where only some lines have it", () => {
    expect(show(applyMarkdownAction(state("[- One\nTwo]"), "bullet"))).toBe("[- One\n- Two]");
  });

  it("switches one kind of list or heading for another", () => {
    expect(show(applyMarkdownAction(state("[- One\n- Two]"), "numbered"))).toBe("[1. One\n2. Two]");
    expect(show(applyMarkdownAction(state("[1. One\n2. Two]"), "task"))).toBe("[- [ ] One\n- [ ] Two]");
    expect(show(applyMarkdownAction(state("- [x] Do|ne"), "bullet"))).toBe("- Do|ne");
    expect(show(applyMarkdownAction(state("# Go|al"), "heading"))).toBe("## Go|al");
  });

  it("does not count a task item as a bullet", () => {
    expect(show(applyMarkdownAction(state("- [ ] Re|ad"), "bullet"))).toBe("- Re|ad");
  });
});

describe("code block", () => {
  it("fences the selected lines on their own lines", () => {
    expect(show(applyMarkdownAction(state("Run:\npnpm [i\npnpm t]est\nDone"), "codeBlock"))).toBe(
      "Run:\n```\n[pnpm i\npnpm test]\n```\nDone",
    );
  });

  it("opens an empty block with the caret inside", () => {
    expect(show(applyMarkdownAction(state("|"), "codeBlock"))).toBe("```\n|\n```");
  });

  it("removes the fences when the lines are already fenced", () => {
    expect(show(applyMarkdownAction(state("[```\npnpm i\n```]"), "codeBlock"))).toBe("[pnpm i]");
  });
});

// Link syntax uses brackets, so these spell out the selection instead of marking it.
describe("link", () => {
  const selected = ({ value, selectionStart, selectionEnd }: EditorState) => value.slice(selectionStart, selectionEnd);

  it("links the selection, selecting the url to replace", () => {
    const result = applyMarkdownAction({ value: "See the docs now", selectionStart: 4, selectionEnd: 12 }, "link");
    expect(result.value).toBe("See [the docs](url) now");
    expect(selected(result)).toBe("url");
    expect(result.selectionStart).toBe(15);
  });

  it("inserts a link with its text selected when nothing is selected", () => {
    const result = applyMarkdownAction({ value: "See ", selectionStart: 4, selectionEnd: 4 }, "link");
    expect(result.value).toBe("See [link text](url)");
    expect(selected(result)).toBe("link text");
    expect(result.selectionStart).toBe(5);
  });
});
