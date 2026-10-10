"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function beat(course: string, position: number, watched: number, focusLoss = false, prompt = false) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("elearning_beat", { p_course: course, p_position: Math.floor(position), p_watched: Math.floor(watched), p_focus_loss: focusLoss, p_prompt: prompt });
  if (error) return { error: error.message };
  return data as { watched: number; max: number; required: number; done: boolean };
}

export async function submitExam(course: string, answers: number[]) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("elearning_submit", { p_course: course, p_answers: answers });
  revalidatePath("/benim/egitim");
  revalidatePath("/benim/isg");
  if (error) return { error: error.message };
  return data as { score: number; passed: boolean; attempts: number };
}
