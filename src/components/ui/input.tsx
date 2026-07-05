import * as React from "react"

import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  onClick,
  onKeyDown,
  onPointerDown,
  ...props
}: React.ComponentProps<"input">) {
  const openDatePicker = (input: HTMLInputElement) => {
    if (type !== "date" || input.disabled || input.readOnly) return;
    try {
      input.focus({ preventScroll: true });
      input.showPicker?.();
    } catch {
      // Some browsers only allow showPicker during direct user gestures.
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    openDatePicker(event.currentTarget);
  };

  const handleClick = (event: React.MouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    openDatePicker(event.currentTarget);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) return;
    openDatePicker(event.currentTarget);
  };

  return (
    <input
      type={type}
      data-slot="input"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        type === "date" && "cursor-pointer",
        className
      )}
      {...props}
    />
  )
}

export { Input }
