import { RuleTester } from "@typescript-eslint/rule-tester";
import { rule, RULE_NAME } from "./server-action-must-wrap-tenant";

if (typeof describe === "undefined") {
  RuleTester.describe = (name, fn) => fn();
  RuleTester.it = (_name, fn) => fn();
  RuleTester.afterAll = () => {};
}

const ruleTester = new RuleTester();
const actionsFilename = "app/src/modules/producto/http/actions.ts";

ruleTester.run(RULE_NAME, rule, {
  valid: [
    // (a) export async function name() {} — wrap as first statement
    {
      filename: actionsFilename,
      code: "export async function x() { return await withTenantTransaction(ctx, async (tx) => {}); }",
    },
    {
      filename: actionsFilename,
      code: "export async function z() { await withTenantTransaction(ctx, async (tx) => {}); }",
    },
    // (b) export function name() {}
    {
      filename: actionsFilename,
      code: "export function y() { return withTenantTransaction(ctx, async (tx) => {}); }",
    },
    // (c) export const name = async () => {}
    {
      filename: actionsFilename,
      code: "export const crear = async () => { return withTenantTransaction(ctx, async (tx) => { await prisma.empresa.findMany(); }); };",
    },
    // (d) export default async function name() {}
    {
      filename: actionsFilename,
      code: "export default async function crearDefault() { await withTenantTransaction(ctx, async (tx) => { await prisma.empresa.findMany(); }); }",
    },
    // (e) export default async () => {}
    {
      filename: actionsFilename,
      code: "export default async () => { await withTenantTransaction(ctx, async (tx) => { await prisma.empresa.findMany(); }); };",
    },
    // prisma inside wrap only — no report
    {
      filename: actionsFilename,
      code: "export async function wrapped() { return withTenantTransaction(ctx, async (tx) => { await prisma.empresa.findMany(); }); }",
    },
    // guard before the wrap is legal
    {
      filename: actionsFilename,
      code: "export async function guarded() { if (!user) return; return withTenantTransaction(ctx, async (tx) => { await prisma.empresa.findMany(); }); }",
    },
    {
      filename: actionsFilename,
      code: "export async function guardedBlock() { if (ctx === null) { return; } await withTenantTransaction(ctx, async (tx) => { await prisma.empresa.findMany(); }); }",
    },
    // non-exported internal function is not an action
    {
      filename: actionsFilename,
      code: "async function internal() { return prisma.empresa.findMany(); }",
    },
    // no prisma access at all — pure actions are fine
    {
      filename: actionsFilename,
      code: "export async function noDb() { const x = 1; return withTenantTransaction(ctx, async (tx) => {}); }",
    },
    {
      filename: actionsFilename,
      code: "export async function pure() { return await otherFn(); }",
    },
    {
      filename: actionsFilename,
      code: "export async function other() { otherFn(); }",
    },
    // non-actions filename — rule is scoped to actions files
    {
      filename: "app/src/lib/utils.ts",
      code: "export async function helper() { return prisma.empresa.findMany(); }",
    },
    // test/spec files are excluded even with unwrapped prisma access
    {
      filename: "app/src/modules/producto/http/actions.test.ts",
      code: "export async function testHelper() { await prisma.empresa.findMany(); }",
    },
    {
      filename: "app/src/modules/producto/http/actions.spec.ts",
      code: "export async function specHelper() { await prisma.empresa.findMany(); }",
    },
    // split action files with proper wrap stay in scope and pass
    {
      filename: "app/src/modules/auth/http/actions.login.ts",
      code: "export async function login() { return withTenantTransaction(ctx, async (tx) => { await prisma.empresa.findMany(); }); }",
    },
    {
      filename: "app/src/modules/auth/http/actions.shared.ts",
      code: "export const obtenerUsuarioActual = async () => { return withTenantTransaction(ctx, async (tx) => { await prisma.usuario.findFirst(); }); };",
    },
    {
      filename: "app/src/modules/devolucion/http/actions.devolver.ts",
      code: "export async function devolver() { await withTenantTransaction(ctx, async (tx) => {}); }",
    },
  ],
  invalid: [
    // arrow export with prisma outside the wrap
    {
      filename: actionsFilename,
      code: "export const badArrow = async () => { await prisma.empresa.findMany(); };",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    // wrap first, then prisma after it — must be invalid
    {
      filename: actionsFilename,
      code: "export async function leaky() { await withTenantTransaction(ctx, async (tx) => {}); await prisma.empresa.findMany(); }",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    // prisma before the wrap
    {
      filename: actionsFilename,
      code: "export async function beforeWrap() { await prisma.empresa.findMany(); return withTenantTransaction(ctx, async (tx) => {}); }",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    // prisma access with no withTenantTransaction call at all
    {
      filename: actionsFilename,
      code: "export async function rawDb() { await prisma.empresa.findMany(); }",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    // default arrow export with prisma outside the wrap
    {
      filename: actionsFilename,
      code: "export default async () => { await prisma.empresa.findMany(); };",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    // prisma in a nested callback defined outside the wrap
    {
      filename: actionsFilename,
      code: "export async function nested() { const cb = async () => prisma.empresa.findMany(); await withTenantTransaction(ctx, async (tx) => {}); return cb(); }",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    // split action file with unwrapped prisma access — must report
    {
      filename: "app/src/modules/auth/http/actions.login.ts",
      code: "export async function login() { await prisma.empresa.findMany(); }",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    {
      filename: "app/src/modules/devolucion/http/actions.shared.ts",
      code: "export const shared = async () => { const data = await prisma.empresa.findMany(); return data; };",
      errors: [{ messageId: "missingTenantWrap" }],
    },
    {
      filename: "app/src/modules/devolucion/http/actions.devolver.ts",
      code: "export default async function devolver() { await prisma.empresa.findMany(); }",
      errors: [{ messageId: "missingTenantWrap" }],
    },
  ],
});