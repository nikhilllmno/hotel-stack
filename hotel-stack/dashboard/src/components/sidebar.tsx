"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppWindow, BedDouble, Bot, FileDiff, FileText, FlaskConical, History, MessageSquareText, PhoneCall, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string; icon: LucideIcon };

const SECTIONS: { title: string; links: NavLink[] }[] = [
  { title: "Owner", links: [{ href: "/doss", label: "Doss", icon: Bot }, { href: "/changes", label: "Pending changes", icon: FileDiff }, { href: "/reports", label: "Reports", icon: FileText }, { href: "/apps", label: "Apps", icon: AppWindow }] },
  {
    title: "Danny",
    links: [
      { href: "/calls", label: "Call Insights", icon: PhoneCall },
      { href: "/bookings", label: "Bookings", icon: BedDouble },
      { href: "/sms", label: "SMS logs", icon: MessageSquareText },
    ],
  },
  {
    title: "Dextr",
    links: [
      { href: "/evaluations", label: "Evaluations", icon: FlaskConical },
      { href: "/snapshots", label: "AI Snapshots", icon: History },
    ],
  },
];

export function Sidebar() {
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const load = () => fetch("/api/doss/reports-unread").then((r) => (r.ok ? r.json() : { unread: 0 })).then((d) => setUnread(d.unread)).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [path]);
  return <SidebarLinks path={path} counts={{ "/reports": unread }} />;
}

/** Plain links; `path` highlights the active page (empty while the URL is not known yet). */
export function SidebarLinks({ path, counts = {} }: { path: string; counts?: Record<string, number> }) {
  return (
    <nav className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground">
      <div className="mb-6 flex items-center gap-2.5 px-2 pt-1">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">CR</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Contigo Ranch</div>
          <div className="text-xs text-muted-foreground">AI front desk</div>
        </div>
      </div>
      {SECTIONS.map((s) => (
        <div key={s.title} className="mb-5">
          <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">{s.title}</div>
          {s.links.map(({ href, label, icon: Icon }) => {
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href}
                className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
                <Icon className="size-4" />
                <span className="flex-1">{label}</span>
                {counts[href] ? <span className="rounded-full bg-sky-500 px-1.5 text-[11px] font-medium text-white">{counts[href]}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
