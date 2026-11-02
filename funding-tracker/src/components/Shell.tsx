import { Nav } from "@/components/Nav";
import { requireProfile } from "@/lib/auth";

/** Wraps every signed-in page with the nav bar. */
export async function Shell({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <>
      <Nav profile={profile} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}
