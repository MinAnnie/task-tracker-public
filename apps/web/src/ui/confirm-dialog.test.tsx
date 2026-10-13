import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Remove @maria?"
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      >
        They’ll be signed out.
      </ConfirmDialog>,
    );
    return { onConfirm, onCancel, user: userEvent.setup() };
  }

  it("is a labelled, described alert dialog that focuses Cancel first", () => {
    setup();
    const dialog = screen.getByRole("alertdialog", { name: "Remove @maria?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("They’ll be signed out.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms or cancels", async () => {
    const { onConfirm, onCancel, user } = setup();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("can require typing a confirmation text first", async () => {
    const { onConfirm, user } = setup({ confirmText: "shop" });
    const confirm = screen.getByRole("button", { name: "Remove" });
    const input = screen.getByRole("textbox", { name: "Type shop to confirm" });
    expect(input).toHaveFocus();
    expect(confirm).toBeDisabled();
    await user.type(input, "sho");
    expect(confirm).toBeDisabled();
    await user.type(input, "p");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows an error and a busy state", () => {
    setup({ busy: true, busyLabel: "Removing…", error: "Try again." });
    expect(screen.getByRole("alert")).toHaveTextContent("Try again.");
    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
  });
});
