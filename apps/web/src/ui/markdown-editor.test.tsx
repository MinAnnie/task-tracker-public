import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor.tsx";

function Harness({ initial = "", onChange }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="desc">Description</label>
      <MarkdownEditor
        id="desc"
        value={value}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
    </>
  );
}

function setup(initial?: string) {
  const onChange = vi.fn();
  render(<Harness initial={initial} onChange={onChange} />);
  const textarea = screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement;
  return { onChange, textarea, user: userEvent.setup() };
}

const selection = (textarea: HTMLTextAreaElement) =>
  textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);

describe("MarkdownEditor", () => {
  it("offers a labelled formatting toolbar that controls the field", () => {
    const { textarea } = setup();
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    expect(toolbar).toHaveAttribute("aria-controls", textarea.id);
    expect(within(toolbar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Heading",
      "Bold",
      "Italic",
      "Inline code",
      "Link",
      "Bulleted list",
      "Numbered list",
      "Task list",
      "Quote",
      "Code block",
    ]);
    expect(within(toolbar).getByRole("button", { name: "Bold" })).toHaveAccessibleDescription("Bold (Ctrl+B)");
    expect(within(toolbar).getByRole("button", { name: "Italic" })).toHaveAccessibleDescription("Italic (Ctrl+I)");
    expect(screen.getByText("Markdown supported.")).toBeInTheDocument();
  });

  it("wraps the selection in bold, keeping the field focused with the text selected", async () => {
    const { onChange, textarea, user } = setup("Ship it now");
    textarea.focus();
    textarea.setSelectionRange(5, 7);
    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(onChange).toHaveBeenLastCalledWith("Ship **it** now");
    expect(textarea).toHaveValue("Ship **it** now");
    expect(textarea).toHaveFocus();
    expect(selection(textarea)).toBe("it");
  });

  it("formats every selected line as a list", async () => {
    const { textarea, user } = setup("One\nTwo");
    textarea.setSelectionRange(0, 7);
    await user.click(screen.getByRole("button", { name: "Numbered list" }));
    expect(textarea).toHaveValue("1. One\n2. Two");
  });

  it("applies bold and italic with Ctrl+B and Ctrl+I", async () => {
    const { textarea, user } = setup();
    await user.click(textarea);
    await user.keyboard("{Control>}b{/Control}");
    expect(textarea).toHaveValue("**bold text**");
    expect(selection(textarea)).toBe("bold text");
    await user.keyboard("Ship");
    await user.keyboard("{Meta>}i{/Meta}");
    expect(textarea).toHaveValue("**Ship_italic text_**");
    expect(selection(textarea)).toBe("italic text");
  });

  it("moves between toolbar buttons with the arrow keys, one Tab stop for the whole toolbar", async () => {
    const { textarea, user } = setup("Ship it");
    textarea.setSelectionRange(0, 4);
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[0]]);

    buttons[0]?.focus();
    await user.keyboard("{ArrowRight}");
    expect(buttons[1]).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(buttons.at(-1)).toHaveFocus();
    await user.keyboard("{Home}{ArrowRight}{Enter}");
    expect(textarea).toHaveValue("**Ship** it");
    expect(textarea).toHaveFocus();
  });

  it("previews the Markdown in a tab, hiding the toolbar", async () => {
    const { user } = setup("## Goal\n\nShip **it** [docs](https://example.com)");
    const preview = screen.getByRole("tab", { name: "Preview" });
    expect(screen.getByRole("tab", { name: "Write" })).toHaveAttribute("aria-selected", "true");

    await user.click(preview);
    expect(preview).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "Preview" });
    expect(within(panel).getByRole("heading", { level: 2, name: "Goal" })).toBeInTheDocument();
    expect(within(panel).getByText("it").tagName).toBe("STRONG");
    expect(within(panel).getByRole("link", { name: "docs" })).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Write" }));
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
  });

  it("says there is nothing to preview when the field is blank", async () => {
    const { user } = setup("   ");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("tabpanel", { name: "Preview" })).toHaveTextContent("Nothing to preview.");
  });

  it("switches tabs with the arrow keys", async () => {
    const { user } = setup();
    screen.getByRole("tab", { name: "Write" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  });

  it("passes field attributes through to the textarea", () => {
    render(
      <MarkdownEditor
        id="d"
        aria-label="Notes"
        aria-invalid
        aria-describedby="d-error"
        maxLength={50}
        disabled
        value=""
        onChange={() => {}}
      />,
    );
    const textarea = screen.getByRole("textbox", { name: "Notes" });
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAttribute("aria-describedby", "d-error");
    expect(textarea).toHaveAttribute("maxlength", "50");
    expect(textarea).toBeDisabled();
    for (const button of within(screen.getByRole("toolbar")).getAllByRole("button")) expect(button).toBeDisabled();
  });
});
