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
import { useActionState } from "react";
import LoginPage from "./page";

// Wraps the real hook so one test can feed an error state without submitting a form.
jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return { ...actual, useActionState: jest.fn(actual.useActionState) };
});

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

  it("shows the CODIGO-usuario shape as placeholder and keeps the label (multi-company C4)", () => {
    render(<LoginPage />);

    const campo = screen.getByLabelText("Usuario");
    expect(campo).toHaveAttribute("placeholder", "CODIGO-usuario");
    // Lenient login: no client-side format constraint that would act as a format oracle.
    expect(campo).not.toHaveAttribute("pattern");
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

  it("board 01 copy (wireframe): subtitle and submit read 'Iniciar sesión'", () => {
    render(<LoginPage />);

    expect(screen.getByText("Inicia sesión para continuar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ingresar" })).toBeNull();
  });

  it("shows the CODIGO-usuario format hint and ties it to the field (aria-describedby)", () => {
    render(<LoginPage />);

    const hint = screen.getByText("Formato: CÓDIGO-usuario (ej. DEMO-admin)");
    const campo = screen.getByLabelText("Usuario");
    expect(hint.id).not.toBe("");
    expect(campo.getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("phone keyboards do not capitalise, correct or spell-check the username", () => {
    render(<LoginPage />);

    const campo = screen.getByLabelText("Usuario");
    expect(campo).toHaveAttribute("autocapitalize", "none");
    expect(campo).toHaveAttribute("autocorrect", "off");
    expect(campo).toHaveAttribute("spellcheck", "false");
  });

  it("password recovery is plain text pointing to the administrator, with no fake focusable control", () => {
    render(<LoginPage />);

    expect(
      screen.getByText("¿Olvidaste tu contraseña? Contacta al administrador."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Recuperar contraseña")).toBeNull();
    // Only real controls may be focusable: no span/p/div carrying a tabindex or aria-disabled.
    expect(document.querySelector("span[tabindex], p[tabindex], div[tabindex]")).toBeNull();
    expect(document.querySelector("span[aria-disabled], p[aria-disabled], div[aria-disabled]")).toBeNull();
  });

  it("without an error the fields are not marked invalid", () => {
    render(<LoginPage />);

    for (const campo of [screen.getByLabelText("Usuario"), screen.getByLabelText("Contraseña")]) {
      expect(campo).not.toHaveAttribute("aria-invalid");
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("with an error the alert is linked to both fields (aria-invalid + aria-describedby)", () => {
    const real = jest.requireActual("react").useActionState;
    (useActionState as jest.Mock).mockReturnValueOnce([
      { error: "Credenciales inválidas" },
      jest.fn(),
      false,
    ]);
    render(<LoginPage />);

    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Credenciales inválidas");
    for (const campo of [screen.getByLabelText("Usuario"), screen.getByLabelText("Contraseña")]) {
      expect(campo).toHaveAttribute("aria-invalid", "true");
      expect(campo.getAttribute("aria-describedby")).toContain(alerta.id);
    }
    // The username keeps its format hint next to the alert reference.
    expect(screen.getByLabelText("Usuario").getAttribute("aria-describedby")).toContain(
      screen.getByText("Formato: CÓDIGO-usuario (ej. DEMO-admin)").id,
    );
    (useActionState as jest.Mock).mockImplementation(real);
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