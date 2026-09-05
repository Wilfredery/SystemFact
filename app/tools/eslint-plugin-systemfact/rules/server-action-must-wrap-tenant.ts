import { ESLintUtils } from "@typescript-eslint/utils";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

export const RULE_NAME = "server-action-must-wrap-tenant";

type FunctionLike =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

function isNode(value: unknown): value is TSESTree.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Nodes that can appear as the function of an exported server action. */
function isFunctionLike(node: TSESTree.Node | null | undefined): node is FunctionLike {
  if (node === null || node === undefined) return false;
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function isWithTenantTransactionCall(
  node: TSESTree.Node | null | undefined,
): boolean {
  if (node === null || node === undefined) return false;

  if (node.type === "CallExpression") {
    const { callee } = node;
    return callee.type === "Identifier" && callee.name === "withTenantTransaction";
  }

  return false;
}

/**
 * Extract the function node (and its report name) from any of the supported
 * export shapes:
 *   (a) export async function name() {}
 *   (b) export function name() {}
 *   (c) export const name = async () => {}
 *   (d) export default async function name() {}
 *   (e) export default async () => {}
 */
function getExportedFunction(
  declaration: TSESTree.Node | null,
): { fn: FunctionLike; name: string } | null {
  if (declaration === null) return null;

  if (declaration.type === "FunctionDeclaration") {
    return { fn: declaration, name: declaration.id?.name ?? "anonymous" };
  }

  if (declaration.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations) {
      const init = declarator.init;
      if (isFunctionLike(init)) {
        const name = declarator.id.type === "Identifier" ? declarator.id.name : "anonymous";
        return { fn: init, name };
      }
    }
    return null;
  }

  if (isFunctionLike(declaration)) {
    return { fn: declaration, name: "anonymous" };
  }

  return null;
}

interface AnalyzeResult {
  /** MemberExpressions whose object is the identifier `prisma`. */
  prismaAccesses: TSESTree.MemberExpression[];
  /** Callback functions passed to withTenantTransaction(ctx, cb). */
  wrapCallbacks: FunctionLike[];
}

/** Traverse a subtree and collect prisma access + wrap callback info. */
function analyzeFunctionBody(
  body: TSESTree.Node,
  visitorKeys: TSESLint.SourceCode["visitorKeys"],
): AnalyzeResult {
  const result: AnalyzeResult = { prismaAccesses: [], wrapCallbacks: [] };

  const walk = (node: TSESTree.Node): void => {
    if (node.type === "MemberExpression") {
      const { object } = node;
      if (object.type === "Identifier" && object.name === "prisma") {
        result.prismaAccesses.push(node);
      }
    } else if (node.type === "CallExpression" && isWithTenantTransactionCall(node)) {
      const callback = node.arguments[1];
      if (callback !== undefined && isFunctionLike(callback)) {
        result.wrapCallbacks.push(callback);
      }
    }

    const keys = visitorKeys[node.type] ?? [];
    for (const key of keys) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isNode(item)) walk(item);
        }
      } else if (isNode(child)) {
        walk(child);
      }
    }
  };

  walk(body);
  return result;
}

/** True when `node` appears lexically inside `container` (range-based). */
function isInside(node: TSESTree.Node, container: TSESTree.Node): boolean {
  return (
    node.range[0] >= container.range[0] &&
    node.range[1] <= container.range[1]
  );
}

export const rule = ESLintUtils.RuleCreator(
  (name) => `https://systemfact.dev/docs/eslint/${name}`,
)({
  name: RULE_NAME,
  meta: {
    type: "problem",
    docs: {
      description:
        "Server Actions must only access prisma inside withTenantTransaction(ctx, async (tx) => {...}) to enforce tenant isolation",
    },
    messages: {
      missingTenantWrap:
        'Server Action "{{name}}" accesses prisma outside withTenantTransaction(ctx, async (tx) => {...}). All prisma access must happen inside the tenant wrap.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const isActionsFile = /[\\/]actions\.tsx?$/.test(filename);
    if (!isActionsFile) {
      return {};
    }

    const visitorKeys = context.sourceCode.visitorKeys;

    function checkFunction(exported: { fn: FunctionLike; name: string }): void {
      const body = exported.fn.body;
      if (body === null || body === undefined) {
        return;
      }

      const { prismaAccesses, wrapCallbacks } = analyzeFunctionBody(body, visitorKeys);
      if (prismaAccesses.length === 0) {
        // Pure actions (no DB access) are fine; nothing to wrap.
        return;
      }

      // Every prisma access must live lexically inside a wrap callback. If the
      // function never calls withTenantTransaction, no access is wrapped.
      const unwrappedAccess = prismaAccesses.find(
        (access) => !wrapCallbacks.some((callback) => isInside(access, callback)),
      );
      if (unwrappedAccess !== undefined) {
        context.report({
          node: exported.fn,
          messageId: "missingTenantWrap",
          data: { name: exported.name },
        });
      }
    }

    return {
      ExportNamedDeclaration(node): void {
        const exported = getExportedFunction(node.declaration);
        if (exported !== null) {
          checkFunction(exported);
        }
      },
      ExportDefaultDeclaration(node): void {
        const exported = getExportedFunction(node.declaration);
        if (exported !== null) {
          checkFunction(exported);
        }
      },
    };
  },
});