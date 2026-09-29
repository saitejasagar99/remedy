"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { MemoryBanner } from "./MemoryBanner";

/* ------------------------------------------------------------------ icons */

const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  findings: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1.2" />
      <circle cx="3.5" cy="12" r="1.2" />
      <circle cx="3.5" cy="18" r="1.2" />
    </>
  ),
  investigate: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  memory: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  remediations: (
    <>
      <path d="M12 3 20 6v6c0 4.4-3.2 8.3-8 9-4.8-.7-8-4.6-8-9V6l8-3Z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  demo: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" />
    </>
  ),
};

function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

/* -------------------------------------------------------------------- nav */

const NAV = [
  { href: "/", label: "Dashboard", icon: "dashboard", blurb: "Portfolio & memory impact" },
  { href: "/findings", label: "Findings", icon: "findings", blurb: "Everything on record" },
  { href: "/investigate", label: "Investigate", icon: "investigate", blurb: "Run the workflow" },
  { href: "/memory", label: "Memory", icon: "memory", blurb: "What the org remembers" },
  { href: "/remediations", label: "Remediations", icon: "remediations", blurb: "Lifecycle & outcomes" },
  { href: "/demo", label: "Demo Mode", icon: "demo", blurb: "Guided learning loop" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-white/10 font-medium text-white"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            }`}
          >
            <span className={active ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300"}>
              <Icon name={item.icon} />
            </span>
            <span className="min-w-0">
              <span className="block leading-tight">{item.label}</span>
              <span className="block text-[10px] leading-tight text-zinc-500">{item.blurb}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-emerald-500 text-[13px] font-bold tracking-tighter text-zinc-950">
        R
      </span>
      <span className="min-w-0">
        <span className={`block font-semibold tracking-[0.18em] text-white ${compact ? "text-xs" : "text-sm"}`}>
          REMEDY
        </span>
        {!compact && (
          <span className="block text-[10px] leading-tight text-zinc-500">
            Compliance remediation memory
          </span>
        )}
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ shell */

/**
 * Application chrome: fixed sidebar on desktop, a scrollable nav row below
 * that, and the memory-layer health readout that every screen shares.
 *
 * The health readout is deliberately always visible. When Hindsight is down
 * the whole product degrades to stateless answers, and a judge must be able to
 * see that at a glance rather than discover it from a recommendation.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  // Re-poll memory health periodically: the server can come back up while a
  // page is open, and the banner should recover without a manual reload.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------- desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-800 bg-zinc-950 px-3 py-4 lg:flex">
        <div className="px-2">
          <Brand />
          <p className="mt-4 border-l-2 border-emerald-500/60 pl-2.5 text-[11px] leading-snug text-zinc-400">
            Don&rsquo;t just find the failure.
            <br />
            <span className="text-zinc-200">Remember what happened after the fix.</span>
          </p>
        </div>

        <div className="mt-6 flex-1 overflow-y-auto">
          <NavLinks pathname={pathname} />
        </div>

        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="px-2 text-[10px] uppercase tracking-wider text-zinc-600">Memory layer</p>
          <div className="mt-1.5 px-2 text-zinc-300">
            <MemoryBanner tick={tick} />
          </div>
        </div>
      </aside>

      {/* --------------------------------------------- mobile top chrome */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950 px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Brand compact />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300"
            aria-expanded={menuOpen}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                  active
                    ? "bg-emerald-500 font-medium text-zinc-950"
                    : "bg-zinc-900 text-zinc-300"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        {menuOpen && (
          <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900 p-2">
            <NavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          </div>
        )}
      </header>

      {/* ------------------------------------------------------ content */}
      <div className="lg:pl-60">
        <div className="border-b border-zinc-200 bg-white/70 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
            <p className="text-[11px] text-zinc-500">
              Recurring finding <span className="text-zinc-400">→</span> historical memory{" "}
              <span className="text-zinc-400">→</span> recommendation{" "}
              <span className="text-zinc-400">→</span> your approval{" "}
              <span className="text-zinc-400">→</span> outcome{" "}
              <span className="text-zinc-400">→</span> back into memory
            </p>
            <div className="text-zinc-700">
              <MemoryBanner tick={tick} />
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>

        <footer className="mx-auto max-w-[1500px] border-t border-zinc-200 px-4 py-5 text-[11px] leading-relaxed text-zinc-500 sm:px-6 lg:px-8">
          Remediation is <strong className="font-semibold text-zinc-700">simulated</strong>. REMEDY
          never modifies real infrastructure and never executes model output. A human approval is
          required before every remediation. Synthetic findings only — no real employee or
          contractor identities are represented.
        </footer>
      </div>
    </div>
  );
}

export { Icon };
