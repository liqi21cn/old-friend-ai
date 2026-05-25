import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-2xs font-medium tracking-wide whitespace-nowrap leading-none",
  {
    variants: {
      variant: {
        default: "bg-elevated text-subtle border border-border",
        primary: "bg-primary/15 text-primary border border-primary/30",
        accent: "bg-accent/15 text-accent border border-accent/30",
        secondary: "bg-secondary/15 text-secondary border border-secondary/30",
        success: "bg-success/15 text-success border border-success/30",
        warning: "bg-warning/15 text-warning border border-warning/30",
        destructive: "bg-destructive/15 text-destructive border border-destructive/30",
        ghost: "text-faint",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
