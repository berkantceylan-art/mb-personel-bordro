"use server";
import { revalidatePath } from "next/cache";
import { done, fail } from "@/lib/flash";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (id: string) => { revalidatePath("/duyurular"); revalidatePath(`/duyurular/${id}`); };

export async function ackAnnouncement(f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const id = str(f, "id");
  const { error } = await supabase.from("announcement_reads").upsert({ announcement_id: id, user_id: s.userId, acked_at: new Date().toISOString() }, { onConflict: "announcement_id,user_id" });
  if (error) await fail(error.message);
  back(id);
  await done("Okuyup anladığınızı onayladınız.");
}

export async function rsvp(status: "yes" | "no" | "maybe", f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const id = str(f, "id");
  const { error } = await supabase.from("event_rsvps").upsert({ announcement_id: id, user_id: s.userId, status, updated_at: new Date().toISOString() }, { onConflict: "announcement_id,user_id" });
  if (error) await fail(error.message);
  back(id);
  await done(status === "yes" ? "Katılımınız kaydedildi." : status === "maybe" ? "Belki olarak işaretlendi." : "Katılmayacağınız kaydedildi.");
}

export async function votePoll(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const id = str(f, "id");
  const opts = f.getAll("option").map(String);
  if (!opts.length) await fail("Bir seçenek işaretleyin.");
  const { error } = await supabase.rpc("vote_poll", { p_ann: id, p_options: opts });
  if (error) await fail(error.message);
  back(id);
  await done("Oyunuz kaydedildi.");
}

export async function askQuestion(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const id = str(f, "id");
  const body = str(f, "body");
  if (body.length < 3) await fail("Sorunuzu yazın.");
  const { error } = await supabase.from("qa_questions").insert({ announcement_id: id, body: body.slice(0, 1000), anonymous: f.get("anonymous") === "on" });
  if (error) await fail(error.message);
  back(id);
  await done("Sorunuz iletildi.");
}

export async function voteQuestion(f: FormData) {
  const s = await getSession();
  const supabase = await createClient();
  const q = str(f, "question");
  if (str(f, "on") === "1") await supabase.from("qa_votes").insert({ question_id: q, user_id: s.userId });
  else await supabase.from("qa_votes").delete().eq("question_id", q).eq("user_id", s.userId);
  back(str(f, "id"));
}

export async function answerQuestion(f: FormData) {
  await getSession();
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_question", { p_question: str(f, "question"), p_answer: str(f, "answer"), p_hidden: f.get("hidden") === "on" });
  if (error) await fail(error.message);
  back(str(f, "id"));
  await done("Yanıt kaydedildi.");
}
