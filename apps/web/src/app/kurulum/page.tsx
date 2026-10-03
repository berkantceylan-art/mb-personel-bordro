import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function setup(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const branch = String(formData.get("branch") ?? "").trim() || "Merkez";
  if (!name) return;
  const { error } = await supabase.rpc("create_company", { p_name: name, p_branch: branch });
  if (error) throw new Error(error.message);
  redirect("/");
}

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");
  const { data: m } = await supabase.from("memberships").select("company_id").eq("user_id", user.id).limit(1).maybeSingle();
  if (m) redirect("/");
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form action={setup} className="w-full max-w-md bg-white border border-line rounded-2xl p-8 flex flex-col gap-5">
        <div>
          <h1 className="font-display font-bold text-xl text-brand-800">Şirket kurulumu</h1>
          <p className="text-sm text-muted mt-1">İlk kurulumda şirketiniz ve ilk şubeniz oluşturulur; siz şirket sahibi olarak eklenirsiniz.</p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Şirket adı
          <input name="name" required defaultValue="MB Dental" className="h-12 rounded-lg border border-line px-3 text-ink" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          İlk şube
          <input name="branch" defaultValue="İzmir Merkez" className="h-12 rounded-lg border border-line px-3 text-ink" />
        </label>
        <button className="h-12 rounded-lg bg-brand-700 text-white font-semibold">Kurulumu tamamla</button>
      </form>
    </main>
  );
}
