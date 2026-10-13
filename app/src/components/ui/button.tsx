"use client";

/**
 * F0.2 — shadcn Button (base-nova/`@base-ui/react` vendored source), bound to the
 * F0.1 semantic tokens (design D1/D2). Colors route ONLY through the registry
 * (`bg-accent`, `text-accent-fg`, …) so light/dark registries cover both modes
 * with no per-primitive `dark:` overrides (spec: "Dark mode needs no primitive
 * edits").
 *
 * Touch-first sizing (spec: "Button sizes meet the hitbox floor"):
 *  - default `h-11` — 44px touch hitbox floor.
 *  - `pos` `h-12` — 48px high-frequency POS/cart targets.
 *  - `icon` `size-11` (44px) — compact icon-only, still ≥ 44px envelope.
 * Adjacent interactive primitives stack at the 8px rhythm (`gap-2`).
 */

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-line focus-visible:ring-3 focus-visible:ring-link/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent/80",
        outline: "border-line bg-surface hover:bg-surface-muted hover:text-ink",
        secondary:
          "bg-surface-raised text-ink hover:bg-surface-muted gap-1.5 aria-expanded:bg-surface-muted aria-expanded:text-ink",
        ghost: "hover:bg-surface-muted hover:text-ink aria-expanded:bg-surface-muted aria-expanded:text-ink",
        destructive:
          "bg-danger/10 text-danger hover:bg-danger/20 focus-visible:border-danger/40 focus-visible:ring-danger/20",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 gap-2 px-3",
        pos: "h-12 gap-2 px-4",
        sm: "h-11 px-2.5 text-xs",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
