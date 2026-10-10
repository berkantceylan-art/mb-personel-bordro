import Link from "next/link";
import { Card } from "@/components/ui";
import { me, MyHeader, NotLinked } from "../_shared";

type Course = { id: string; title: string; topic_group: number; duration_min: number; lesson_hours: number; watched_sec: number | null; attempts: number | null; exam_score: number | null; passed: boolean | null };

/** Personel: uzaktan İSG eğitimlerim */
export default async function MyElearning() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Uzaktan eğitimlerim" />;
  const { data, error } = await supabase.rpc("my_elearning");
  const list = (data ?? []) as Course[];
  return (
    <>
      <MyHeader title="Uzaktan eğitimlerim" subtitle="İş sağlığı ve güvenliği eğitimleri" />
      <div className="p-4 md:p-6 flex flex-col gap-3 max-w-[760px]">
        {(error || list.length === 0) && <Card><p className="text-sm text-muted">Size atanmış uzaktan eğitim yok.</p></Card>}
        {list.map((c) => {
          const pct = Math.min(100, Math.round(((c.watched_sec ?? 0) / (c.duration_min * 60)) * 100));
          return (
            <Link key={c.id} href={`/benim/egitim/${c.id}`} className="rounded-[14px] border border-line bg-white p-4 flex flex-col gap-2">
              <div className="flex justify-between gap-2"><b>{c.title}</b>{c.passed ? <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-ok-bg text-ok">Tamamlandı · {c.exam_score}</span> : c.attempts ? <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-bad-bg text-bad">Sınav: {c.exam_score} puan</span> : <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-warn-bg text-warn">{pct ? "Devam ediyor" : "Başlanmadı"}</span>}</div>
              <div className="text-xs text-muted">{c.duration_min} dakika · {Number(c.lesson_hours)} ders saati · {c.topic_group}. konu başlığı</div>
              <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden"><div className="h-full bg-[#1A7F52]" style={{ width: `${pct}%` }} /></div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
