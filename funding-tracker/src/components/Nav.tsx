import Link from "next/link";
import { LayoutGrid, Upload, History, Users, Settings } from "lucide-react";
import type { Profile } from "@/lib/types";

const links = [
  { href: "/", label: "Master sheet", icon: LayoutGrid, min: "viewer" },
  { href: "/upload", label: "Upload", icon: Upload, min: "officer" },
  { href: "/uploads", label: "History", icon: History, min: "viewer" },
  { href: "/clubs", label: "Clubs", icon: Users, min: "viewer" },
  { href: "/admin", label: "Admin", icon: Settings, min: "admin" },
] as const;

const rank = { viewer: 0, officer: 1, admin: 2 } as const;

export function Nav({ profile }: { profile: Profile }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-base font-semibold text-[var(--yale-blue)]">
            Club Funding Tracker
          </Link>
          <nav className="flex items-center gap-1">
            {links
              .filter((l) => rank[profile.role] >= rank[l.min])
              .map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                >
                  <l.icon size={16} />
                  {l.label}
                </Link>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>
            {profile.full_name ?? profile.email}{" "}
            <span className="badge bg-slate-100 text-slate-600">{profile.role}</span>
          </span>
          <form action="/auth/signout" method="post">
            <button className="btn-secondary py-1">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
