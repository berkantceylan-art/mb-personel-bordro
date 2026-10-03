import { Sidebar } from "@/components/Sidebar";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <Sidebar companyName={s.companyName} />
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
