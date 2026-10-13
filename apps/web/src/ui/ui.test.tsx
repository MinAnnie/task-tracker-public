import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./Avatar.tsx";
import { PriorityLabel } from "./PriorityLabel.tsx";
import { StatusChip } from "./StatusChip.tsx";

describe("PriorityLabel", () => {
  it("shows the priority as text next to a decorative bars icon", () => {
    const { container } = render(<PriorityLabel priority="urgent" />);
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StatusChip", () => {
  it("shows the status as text", () => {
    render(<StatusChip status="in_review" />);
    expect(screen.getByText("In review")).toBeInTheDocument();
  });
});

describe("Avatar", () => {
  it("shows initials and exposes the login to assistive tech", () => {
    render(<Avatar user={{ login: "juanperez", name: null }} />);
    expect(screen.getByText("JU")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Assigned to @juanperez")).toBeInTheDocument();
  });
});
