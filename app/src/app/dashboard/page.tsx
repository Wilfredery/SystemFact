import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/modules/auth/http/actions";
import { logoutAction } from "@/modules/auth/http/actions";

export default async function DashboardPage() {
  const user = await getCurrentUserContext();

  if (user === null) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            SF
          </div>
          <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            SystemFact
          </span>
        </div>

        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-11 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cerrar sesión
          </button>
        </form>
      </header>

      <main className="flex flex-1 flex-col items-start gap-4 px-6 py-10">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Hola, {user.nombre}
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          {user.empresa?.nombreComercial ?? "Empresa"}
          {user.sucursal ? ` · ${user.sucursal.nombre}` : ""}
        </p>
        <p className="mt-2 max-w-xl text-sm text-zinc-500 dark:text-zinc-400">
          Este es un panel provisional que será reemplazado por el dashboard
          real en fases posteriores.
        </p>
      </main>
    </div>
  );
}
