import { PageHeader } from "@/components/ui";
import { TaskList, type Task } from "@/components/admin/Tasks";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Görevlerim" };

/** Yöneticinin bana atadığı görevler */
export default async function MyTasks() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_tasks_list", { p_mine: true });
  const tasks = (error ? [] : (data as Task[])) ?? [];
  return (
    <>
      <PageHeader title="Görevlerim" subtitle="Yöneticinizin size atadığı işler" />
      <div className="p-4 md:p-6 max-w-[760px]">
        <section className="bg-white border border-line rounded-[18px] px-4">
          <TaskList tasks={tasks} admin={false} empty="Size atanmış açık görev yok 🎉" />
        </section>
      </div>
    </>
  );
}
