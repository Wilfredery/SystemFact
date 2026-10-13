import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Tokens-only (F0.1): line = `--line`, focus ring = `--link`. No raw
        // grays, no dark: overrides — the registries carry both modes.
        "h-11 w-full min-w-0 rounded-lg border border-line bg-transparent px-2.5 text-base transition-colors outline-none placeholder:text-ink-muted focus-visible:border-link focus-visible:ring-3 focus-visible:ring-link/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
