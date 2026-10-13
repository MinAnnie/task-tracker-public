import { render, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { me } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes, renderWithProviders, reply } from "../../test/render.tsx";
import { LoginContainer } from "./LoginContainer.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { RequireAuth } from "./RequireAuth.tsx";

describe("LoginPage", () => {
  it("offers GitHub sign-in", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute("href", "/auth/github");
  });

  it("explains a denied login and offers to try again", () => {
    render(<LoginPage deniedLogin="someone-new" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No access yet");
    expect(alert).toHaveTextContent("@someone-new isn’t a member");
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/auth/github");
    expect(screen.queryByRole("link", { name: "Continue with GitHub" })).not.toBeInTheDocument();
  });
});

describe("LoginContainer", () => {
  it("shows the denied state when the OAuth callback redirected with not_allowed", async () => {
    fakeApi({ "GET /auth/me": reply(401, { error: "unauthenticated" }) });
    renderWithProviders(<LoginContainer />, { route: "/login?error=not_allowed&login=someone-new" });
    expect(await screen.findByRole("alert")).toHaveTextContent("@someone-new");
  });

  it("sends a signed-in user to the app", async () => {
    fakeApi({ "GET /auth/me": me });
    renderWithProviders(<LoginContainer />, { route: "/login" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
  });
});

describe("RequireAuth", () => {
  const tree = (
    <Routes>
      <Route path="/login" element={<p>Login screen</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<p>Private board</p>} />
      </Route>
    </Routes>
  );

  it("sends unauthenticated users to the login screen", async () => {
    fakeApi({ "GET /auth/me": reply(401, { error: "unauthenticated" }) });
    renderRoutes(tree, "/");
    expect(await screen.findByText("Login screen")).toBeInTheDocument();
    expect(screen.queryByText("Private board")).not.toBeInTheDocument();
  });

  it("renders the page for a signed-in user", async () => {
    fakeApi({ "GET /auth/me": me });
    renderRoutes(tree, "/");
    expect(await screen.findByText("Private board")).toBeInTheDocument();
  });
});
