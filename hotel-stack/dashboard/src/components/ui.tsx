import Link from "next/link";
import type { ComponentProps } from "react";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Card as UiCard, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Shared building blocks for every dashboard page (shadcn underneath, same look as the Doss chat). */

export function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <UiCard size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </UiCard>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}

export function Card({ title, description, children, right, className }: {
  title?: string; description?: string; children: React.ReactNode; right?: React.ReactNode; className?: string;
}) {
  return (
    <UiCard className={cn("mb-6", className)}>
      {(title || right) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {right && <CardAction>{right}</CardAction>}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </UiCard>
  );
}

/** 7d / 30d / 60d segmented control that keeps the other query params. */
export function DaysPicker({ days, base, params = {} }: { days: number; base: string; params?: Record<string, string> }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-sm shadow-xs">
      {[7, 30, 60].map((d) => (
        <Link key={d} href={{ pathname: base, query: { ...params, days: d } }}
          className={cn("rounded-md px-3 py-1 transition-colors",
            d === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          {d}d
        </Link>
      ))}
    </div>
  );
}

const TONES = {
  neutral: "bg-secondary text-secondary-foreground",
  green: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/15",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  blue: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/15",
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <UiBadge variant="secondary" className={cn("capitalize", TONES[tone])}>{children}</UiBadge>;
}

/** A selectable row in a side list (threads, runs, versions). */
export function ListLink({ active, className, ...props }: ComponentProps<typeof Link> & { active?: boolean }) {
  return (
    <Link {...props} className={cn("block rounded-md px-2.5 py-2 text-sm transition-colors",
      active ? "bg-muted font-medium" : "text-foreground/80 hover:bg-muted/60", className)} />
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Native form controls styled like shadcn inputs (works in server-rendered GET forms). */
export const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-56 bg-foreground/[0.06]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl bg-foreground/[0.06]" />)}
      </div>
      <Skeleton className="h-72 rounded-xl bg-foreground/[0.06]" />
    </div>
  );
}
