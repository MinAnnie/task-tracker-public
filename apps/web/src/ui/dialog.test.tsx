import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "./Dialog.tsx";

const html = document.documentElement;
const body = document.body;

function TestDialog({ name }: { name: string }) {
  return (
    <Dialog labelledBy={`${name}-title`} onClose={() => {}}>
      <h2 id={`${name}-title`}>{name}</h2>
      <button type="button">OK</button>
    </Dialog>
  );
}

describe("Dialog scroll lock", () => {
  afterEach(() => {
    html.removeAttribute("style");
    body.removeAttribute("style");
  });

  it("locks page scroll while open and restores the previous styles exactly on close", () => {
    body.style.overflow = "scroll";
    const { unmount } = render(<TestDialog name="one" />);

    expect(html.style.overflow).toBe("hidden");
    expect(body.style.overflow).toBe("hidden");

    unmount();
    expect(html.style.overflow).toBe("");
    expect(body.style.overflow).toBe("scroll");
  });

  it("keeps the page locked until the last of several open dialogs closes", () => {
    const first = render(<TestDialog name="first" />);
    const second = render(<TestDialog name="second" />);

    first.unmount();
    expect(html.style.overflow).toBe("hidden");

    second.unmount();
    expect(html.style.overflow).toBe("");
    expect(body.style.overflow).toBe("");
  });

  it("locks again for a dialog opened after another one closed", () => {
    render(<TestDialog name="first" />).unmount();
    const { unmount } = render(<TestDialog name="second" />);

    expect(html.style.overflow).toBe("hidden");
    unmount();
    expect(html.style.overflow).toBe("");
  });
});
