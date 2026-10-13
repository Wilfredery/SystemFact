/** F0.2 — shadcn Badge (base-nova vendored source) bound to the F0.1 tokens:
 * `bg-accent text-accent-fg` default, surfaces for secondary, `text-danger`,
 * `border-line`/`text-ink-muted` outline. No dark: overrides — registries own it. */

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-line focus-visible:ring-[3px] focus-visible:ring-link/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-fg [a]:hover:bg-accent/80",
        secondary:
          "bg-surface-raised text-ink [a]:hover:bg-surface-muted",
        destructive:
          "bg-danger/10 text-danger focus-visible:ring-danger/20 [a]:hover:bg-danger/20",
        outline:
          "border-line text-ink [a]:hover:bg-surface-muted [a]:hover:text-ink-muted",
        ghost: "hover:bg-surface-muted hover:text-ink-muted",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
