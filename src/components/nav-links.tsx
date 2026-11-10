"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const base = "rounded border bg-blue-600 px-2 py-1 text-sm text-white hover:bg-blue-700";
const active = "rounded border bg-blue-800 px-2 py-1 text-sm text-white";

/**
 * Header links. A client component only because it needs the current URL
 * to mark where you are; the session is read by the server component
 * around it.
 */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-2">
      {links.map((l) => {
        const here = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={here ? "page" : undefined} className={here ? active : base}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
