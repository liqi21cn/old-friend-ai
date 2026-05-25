import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-fg hover:bg-primary/90 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset,0_0_24px_rgb(124_58_237/0.25)]",
        secondary:
          "bg-elevated text-foreground hover:bg-elevated/70 border border-border",
        ghost: "text-subtle hover:bg-elevated hover:text-foreground",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-elevated",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        accent:
          "bg-accent text-white hover:bg-accent/90 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset,0_0_18px_rgb(8_145_178/0.25)]",
        link:
          "text-primary underline-offset-4 hover:underline px-1 py-0 h-auto",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
