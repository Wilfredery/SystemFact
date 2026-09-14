/**
 * Conventional Commits — reglas puras (sin git, sin I/O) del proyecto.
 *
 * ¿Por qué existe este módulo? release-please deriva la PRÓXIMA VERSIÓN y el
 * CHANGELOG.md de los asuntos de commit que entran a `master`
 * (ver release-please-config.json). Un asunto que no sigue el formato
 * simplemente desaparece del changelog, en silencio. Este módulo concentra las
 * reglas para que el guardián de CI (tools/ci/check-conventional-commits.ts) y
 * sus tests compartan una única fuente de verdad.
 *
 * Reglas aplicadas (AGENTS.md § Code practices):
 *   1. `<tipo>(<ámbito opcional>)!: <descripción>`, con tipo de la lista.
 *   2. Sin atribución de IA en el cuerpo ("No AI attribution in commits").
 *
 * Los reverts generados por el botón de GitHub (`Revert "<asunto>"`) se
 * aceptan tal cual: son la contraparte exacta de un commit ya validado.
 */

/** Tipos habilitados; espejo de las secciones de release-please-config.json. */
export const TIPOS_CONVENCIONALES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "migrate",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
] as const;

export type TipoConvencional = (typeof TIPOS_CONVENCIONALES)[number];

/**
 * El patrón se construye desde TIPOS_CONVENCIONALES para que la lista de tipos
 * y la validación no puedan divergir (drift imposible por construcción).
 * Ámbito permitido: minúsculas, dígitos, `.`, `_`, `/`, `-` y `,` — este último
 * para commits que tocan varios módulos (`feat(venta,inventario)`), como ya
 * hace la historia del repo.
 */
const PATRON_ASUNTO = new RegExp(
  "^(" + TIPOS_CONVENCIONALES.join("|") + ")(\\([a-z0-9][a-z0-9._/,-]*\\))?!?: \\S.*$",
);

/** `git revert` desde la UI de GitHub produce `Revert "<asunto original>"`. */
const PATRON_REVERT_DE_GITHUB = /^Revert "/;

/**
 * Marcadores de autoría de IA. Patrones deliberadamente ESTRECHOS: solo
 * nombres de asistentes conocidos, para no bloquear un `Co-Authored-By` humano.
 */
const PATRONES_ATRIBUCION_IA: readonly RegExp[] = [
  /^co-authored-by:.*\b(claude|chatgpt|openai|anthropic|copilot|codex|cursor|gemini|devin)\b/im,
  /generated (with|by) .*(claude|chatgpt|copilot|cursor|codex|openai)/i,
];

export interface MensajeCommit {
  readonly sha: string;
  readonly asunto: string;
  readonly cuerpo: string;
}

export interface CommitInvalido {
  readonly sha: string;
  readonly asunto: string;
  readonly motivos: readonly string[];
}

/** Motivos por los que un asunto incumple las reglas (array vacío = cumple). */
export function validarAsunto(asunto: string): readonly string[] {
  const limpio = asunto.trim();
  if (limpio === "") {
    return ["el asunto está vacío"];
  }
  if (PATRON_REVERT_DE_GITHUB.test(limpio)) {
    return [];
  }
  if (!PATRON_ASUNTO.test(limpio)) {
    return [
      "el asunto no sigue `<tipo>(<ámbito>): <descripción>` con un tipo permitido (" +
        TIPOS_CONVENCIONALES.join(", ") +
        ")",
    ];
  }
  return [];
}

/** Motivos por los que un mensaje completo incumple (asunto + cuerpo). */
export function validarMensaje(commit: MensajeCommit): readonly string[] {
  const motivos: string[] = [...validarAsunto(commit.asunto)];
  for (const patron of PATRONES_ATRIBUCION_IA) {
    if (patron.test(commit.cuerpo)) {
      motivos.push(
        "el cuerpo lleva atribución de IA (AGENTS.md: 'No AI attribution in commits')",
      );
      break;
    }
  }
  return motivos;
}

/** Filtra los commits que incumplen, con sus motivos. */
export function validarCommits(
  commits: readonly MensajeCommit[],
): readonly CommitInvalido[] {
  return commits
    .map((commit) => ({
      sha: commit.sha,
      asunto: commit.asunto,
      motivos: validarMensaje(commit),
    }))
    .filter((commit) => commit.motivos.length > 0);
}

/**
 * Parsea la salida de:
 *   git log --no-merges --format=%H%x1f%s%x1f%b%x1e
 * (%x1f = separador de campos, %x1e = separador de registros, porque tanto el
 * asunto como el cuerpo pueden contener saltos de línea).
 */
export function parsearGitLog(salida: string): readonly MensajeCommit[] {
  return salida
    .split("\u001e")
    .map((registro) => registro.replace(/^[\r\n]+/, "").replace(/[\s\r\n]+$/, ""))
    .filter((registro) => registro !== "")
    .map((registro) => {
      const campos = registro.split("\u001f");
      return {
        sha: (campos[0] ?? "").trim(),
        asunto: campos[1] ?? "",
        cuerpo: campos.slice(2).join("\u001f"),
      };
    });
}

/** Reporte legible para la consola de CI. */
export function formatearReporte(
  invalidos: readonly CommitInvalido[],
  totalRevisados: number,
): string {
  const lineas: string[] = [
    "",
    "✖ " +
      invalidos.length +
      " de " +
      totalRevisados +
      " commit(s) del rango no cumplen Conventional Commits:",
    "",
  ];
  for (const commit of invalidos) {
    lineas.push("  " + commit.sha.slice(0, 7) + "  " + commit.asunto);
    for (const motivo of commit.motivos) {
      lineas.push("          → " + motivo);
    }
  }
  lineas.push(
    "",
    "Formato esperado:  <tipo>(<ámbito>): <descripción>",
    "Tipos permitidos:  " + TIPOS_CONVENCIONALES.join(", "),
    "Ejemplos válidos:  feat(venta): confirmar venta emite FACTURA con NCF",
    "                   fix(ncf): bloquear secuencia agotada al confirmar",
    "                   feat(api)!: romper el contrato de POST /ventas",
    "",
    "La versión y el CHANGELOG se derivan de estos asuntos (release-please);",
    "un asunto inválido no aparece en el changelog del release.",
    "",
  );
  return lineas.join("\n");
}
