import { notFound } from "next/navigation";
import { me, MyHeader, NotLinked } from "../../_shared";
import { Player } from "./Player";

type Course = { id: string; title: string; description: string | null; video_url: string | null; video_path: string | null; duration_min: number; questions: Array<{ q: string; options: string[] }>; watched_sec: number | null; max_position_sec: number | null; attempts: number | null; exam_score: number | null; passed: boolean | null };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Uzaktan eğitim" />;
  const { id } = await params;
  const { data } = await supabase.rpc("my_elearning");
  const c = ((data ?? []) as Course[]).find((x) => x.id === id);
  if (!c) notFound();
  let src = c.video_url ?? "";
  if (c.video_path) { const { data: u } = await supabase.storage.from("documents").createSignedUrl(c.video_path, 3 * 3600); src = u?.signedUrl ?? src; }
  return (
    <>
      <MyHeader title={c.title} subtitle={`${c.duration_min} dakika`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[860px]">
        {c.description && <p className="text-sm text-[#33414F]">{c.description}</p>}
        <Player id={c.id} src={src} durationSec={c.duration_min * 60} maxPos={c.max_position_sec ?? 0} watched={c.watched_sec ?? 0} questions={c.questions} attempts={c.attempts ?? 0} passed={!!c.passed} score={c.exam_score} />
      </div>
    </>
  );
}
