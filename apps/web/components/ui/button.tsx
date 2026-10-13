import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background,box-shadow,border-color,color] disabled:pointer-events-none disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(180deg,#6aa6ff,#3a7bff)] text-coach-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_24px_-8px_rgba(77,148,255,0.8)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_30px_-6px_rgba(77,148,255,0.95)]",
  secondary:
    "border border-white/15 bg-white/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md hover:bg-white/[0.14]",
  ghost: "text-ink-muted hover:bg-white/10 hover:text-ink",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
