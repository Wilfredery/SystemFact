# inventario-ajuste — Step 1b of the screens plan: the stock adjust form (Administrador only)

Objective: build the wireframe board `04-Inventario-Ajuste` as drawn, reachable from the `+ Ajustar` button of the consulta screen (`odd/tasks/inventario-consulta.md`, shipped in v0.20.0). Only the manage role group (Administrador) sees the button and the form.
Parent plan and hand-off: `odd/tasks/frontend-screens-plan.md` (Step 1).

## Specs

- **S1** — owner, 2026-11-08: "Go ahead, pls." (answering the agent's offer: "Step 1b, the adjust form (Administrador only), as its own PR. The backend action already exists. Want me to start it?").
- **S2** — owner, 2026-11-08, answer to "What should the number mean?": "Amount to add or remove (Recommended)" = Entrada + 10 adds 10, Salida + 10 removes 10; keep the drawn label "Nueva cantidad" and add a live line "Existencia actual 150 → quedará 160" so nobody mistakes it for the new total.
- **S3** — owner, 2026-11-08, answer to "Which list should the Motivo selector offer?": "Standard six (Recommended)" = Conteo físico, Merma, Producto dañado, Producto vencido, Corrección de error, Otro. The free-text "Observaciones" stays optional below it.
- **S4** — wireframe `04-Inventario-Ajuste` (read 2026-11-08): title "Ajuste de Inventario" with a back arrow; fields "Producto *" (placeholder "Seleccionar producto..."), "Tipo de ajuste *" (buttons "Entrada" and "Salida"), "Motivo *" (placeholder "Seleccionar motivo..."), "Nueva cantidad *" (value "0"), "Observaciones" (placeholder "Detalle opcional del ajuste..."); buttons "Cancelar" and "Confirmar Ajuste". Annotations: "Registrar entrada o salida de stock con motivo"; "Formulario de entrada/salida con motivo; confirmar actualiza la existencia del producto."; reached from "04-Inventario-Consulta → botón + Ajustar"; "Confirmar Ajuste → 04-Inventario-Consulta (stock actualizado)"; "Roles que la ven: Administrador".
- **S5** — owner L8 (plan): follow the wireframe as drawn; one named role group per capability in `http/shared.ts`, screens and actions read the groups, never literal role names (here `ROLES_GESTION_INVENTARIO`).
- **S6** — `AGENTS.md`: multi-tenancy, `withTenantTransaction`, server-side authorization (hiding the button is NOT security), deny by default, no `any`, stable error codes, never expose internals, CSP enforced (add the route to the CSP walk: it derives routes from the filesystem), one local E2E spec, confirmation buttons disabled on first click and the server revalidates, fiscal/inventory operations never optimistic. The backend action `ajustarInventarioAction` (signed delta + mandatory motivo, row lock, `AJUSTE` movement, audit) already exists and is not changed except for what T1 needs.

## Tasks

- [ ] T1 (S4,S5,S6) Permission seam: a server action that answers "may the caller adjust stock" from `ROLES_GESTION_INVENTARIO`; the consulta page uses it to show the `+ Ajustar` link (Administrador only); tests. Risk: item 2 (authorization), own commit.
- [ ] T2 (S2,S3,S4,S6) Screen `/inventario/ajuste`: server page gated by the same seam (a non-manager sees an access message, never the form), client form with product search, Entrada/Salida, motivo select (S3), "Nueva cantidad" with the live preview line (S2), observaciones, Cancelar and Confirmar Ajuste; on success back to `/inventario`; component tests.
- [ ] T3 (S4,S6) Local E2E: Administrador adjusts stock (movement visible in the list), Operador and Despachador get no `+ Ajustar` button and an access message on the direct URL; version bump.

## Log

- L1 (2026-11-08): owner request: "Go ahead, pls." Re-read the wireframe board (S4). Two product questions asked and answered (S2, S3).
- L2 (2026-11-08): design notes. (a) `ajustarInventarioAction` takes a signed delta, so Entrada sends `+q` and Salida `-q`; the motivo sent is the selected label, followed by ": " and the observaciones when given (the backend field is one string, max 255, so observaciones is capped at 200 characters in the form). (b) Known gap, not fixed here: the adjust action is not idempotent (a retried request after a timeout would apply the delta twice). Mitigation in the form: the confirm button stays disabled after the first click, and when the outcome is unknown (the action rejects) the form tells the user to check the Inventario list before retrying instead of re-enabling the button. A proper idempotency key is a follow-up that needs a backend change.
