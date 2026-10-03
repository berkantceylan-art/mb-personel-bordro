"use client";
import { useActionState } from "react";
import { deleteEmployee } from "../../employee-actions";

export function DeleteEmployeeForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteEmployee, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        Onay için SİL yazın
        <input name="confirm" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 max-w-56" />
      </label>
      {state && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-bad-bg text-bad">{state.message}</p>}
      <button disabled={pending} className="h-11 px-5 rounded-[10px] bg-[#B42318] text-white font-semibold self-start disabled:opacity-60">Personeli kalıcı olarak sil</button>
    </form>
  );
}
