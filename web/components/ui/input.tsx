import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-9 w-full rounded border border-border bg-muted px-3 py-1 text-sm transition-colors",
      "placeholder:text-faint",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-primary",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex w-full rounded border border-border bg-muted px-3 py-2 text-sm leading-relaxed transition-colors resize-vertical",
      "placeholder:text-faint",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-primary",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({
  className,
  children,
  required,
  hint,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium text-subtle mb-1.5",
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {required && <span className="text-destructive">*</span>}
      {hint && <span className="text-faint font-normal ml-1">{hint}</span>}
    </label>
  );
}
