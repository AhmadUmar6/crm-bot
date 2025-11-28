import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";

interface PageShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const NAV_ITEMS = [
  { href: "/", label: "Queue" },
  { href: "/chats", label: "Chats" },
];

export function PageShell({
  title,
  subtitle,
  actions,
  children,
}: PageShellProps) {
  const router = useRouter();
  const hasActions = Boolean(actions);

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3rem] text-black/60">
              CRMREBS
            </p>
            <h1 className="text-2xl font-semibold text-black md:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-black/70">{subtitle}</p>
            ) : null}
          </div>
          <nav className="flex flex-wrap items-center gap-2 md:justify-end">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? router.pathname === "/" || router.pathname === ""
                  : router.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-black text-white"
                      : "bg-slate-100 text-black/70 hover:bg-slate-200"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-10">
        <div
          className={clsx(
            "mb-6 flex flex-col gap-3 sm:flex-row sm:items-center",
            hasActions ? "sm:justify-between" : "sm:justify-end"
          )}
        >
          {hasActions ? (
            <div className="flex flex-wrap gap-3">{actions}</div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              document.cookie =
                "crmrebs_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
              void router.replace("/login");
            }}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-black hover:border-slate-400 hover:text-black/70"
          >
            Log out
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}

