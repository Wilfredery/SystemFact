<!--
Plantilla de Pull Request — SystemFact.
El pipeline de CI (`.github/workflows/ci.yml`) corre solo; el job agregado
"CI gate" es el check requerido por la protección de `master`.
-->

## Qué cambia

<!-- Resumen del cambio y por qué es necesario. Enlazá el issue si existe. -->

## Tipo de cambio

- [ ] `feat` — funcionalidad nueva (bump MINOR)
- [ ] `fix` — corrección de bug (bump PATCH)
- [ ] `perf` — mejora de performance (bump PATCH)
- [ ] `refactor` / `docs` / `test` / `build` / `ci` / `chore` (sin bump propio)
- [ ] Cambio incompatible (BREAKING CHANGE) — describirlo abajo

## Cómo se probó

<!-- Comandos ejecutados y resultado. Ej.: pnpm test, pnpm test:integration, pnpm e2e -->

## Checklist (Definition of Done — AGENTS.md)

- [ ] Cumple el requerimiento y sus criterios de aceptación
- [ ] Respeta las reglas de negocio (multi-tenancy, Decimal, NCF, inventario, estados)
- [ ] Tiene tests según la prioridad del área (dominio fiscal > integración > E2E > UI)
- [ ] Está documentado (spec/openspec y docs del módulo)
- [ ] Los commits siguen Conventional Commits y **sin atribución de IA**
- [ ] Si toca el schema: la migración de Prisma va en su propio commit
- [ ] No se commiteó ningún secreto (ni `.env`, ni passwords de roles)

## Notas para el reviewer

<!-- Riesgos, decisiones tomadas, seguimiento pendiente. -->
