/**
 * @jest-environment jsdom
 *
 * Login board 01 surface tests (auth-login-restyle, LOG-01-A/LOG-02-A):
 * exactly two credential fields, no email anywhere, the typed alert copy, and
 * the source-level token gate (LOG-04-A) over page + layout.
 */

import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import LoginPage from "./page";

jest.mock("@/modules/auth/http/actions", () => ({
  login: jest.fn(),
  logoutAction: jest.fn(),
  getCurrentUserContext: jest.fn(),
}));

describe("login board 01 (auth-login-restyle)", () => {
  it("LOG-01-A: exactly TWO credential fields — nombreUsuario + password", () => {
    render(<LoginPage />);

    const fields = screen.getAllByRole("textbox");
    expect(fields).toHaveLength(1); // the ONLY textbox is nombreUsuario
    expect(screen.getByLabelText("Usuario")).toHaveAttribute(
      "autoComplete",
      "username",
    );
    const password = document.querySelector<HTMLInputElement>(
      "input[name='password']",
    );
    expect(password).not.toBeNull();
    expect(password!.type).toBe("password");
    expect(password).toHaveAttribute("autoComplete", "current-password");
    // No email field, no synthetic suffix exposure (ADR-014).
    const source = body();
    expect(source).not.toMatch(/@users\.systemfact\.internal/);
    expect(source).not.toMatch(/type="email"/);
    expect(screen.queryByLabelText(/correo|email/i)).toBeNull();
  });

  it("LOG-02-A: the single alert renders the typed error VERBATIM (no transform, no wrap copy)", () => {
    // The visible copy is owned by the catalog (pinned exactly in
    // errors.test.ts). At the unit level we pin that the page's ONLY error
    // surface prints `state.error` untouched — the alert block must contain
    // the bare interpolation and nothing else.
    const source = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    const alertBlock = source.match(/role="alert"[\s\S]{0,200}?<\/div>/);
    expect(alertBlock).not.toBeNull();
    expect(alertBlock![0]).toContain("{state.error}");
    const alertCount = (source.match(/role="alert"/g) ?? []).length;
    expect(alertCount).toBe(1);
  });

  it("LOG-04-A: no raw palette classes, no hex, no dark variants in page+layout", () => {
    for (const source of [
      readFileSync(path.join(__dirname, "page.tsx"), "utf8"),
      readFileSync(path.join(__dirname, "layout.tsx"), "utf8"),
    ]) {
      expect(source).not.toMatch(/zinc-|indigo-|slate-/);
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
      expect(source).not.toMatch(/dark:/);
    }
  });
});

function body(): string {
  return document.body.innerHTML;
}