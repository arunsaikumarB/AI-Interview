import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Semantic glass wrappers — visual only. */

export function GlassShell({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("glass-shell", className)} {...props} />;
}

export function GlassCard({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("glass-card", className)} {...props} />;
}

export function GlassPanel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("glass-panel", className)} {...props} />;
}

export function GlassSidebar({
  className,
  ...props
}: React.ComponentProps<"aside">) {
  return <aside className={cn("glass-sidebar", className)} {...props} />;
}

export function GlassTopbar({
  className,
  ...props
}: React.ComponentProps<"header">) {
  return <header className={cn("glass-topbar", className)} {...props} />;
}

export function GlassInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return <Input className={cn("glass-control", className)} {...props} />;
}

export function GlassButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button className={cn(className)} {...props} />;
}

export function GlassModal({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("glass-modal rounded-[var(--radius-card)] p-5", className)} {...props} />;
}
