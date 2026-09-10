import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border border-transparent px-2 py-1 text-[11px] font-bold uppercase tracking-[.08em]",
  {
    variants: {
      variant: {
        neutral: "bg-secondary text-secondary-foreground",
        primary: "bg-primary/10 text-primary",
        info: "bg-chart-2/10 text-chart-2",
        warning: "bg-accent/15 text-accent-foreground",
        success: "bg-chart-3/10 text-chart-3",
        danger: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
