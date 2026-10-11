import Link from "next/link";
import { LEVEL_CLS, MOD_INFO } from "@/lib/users";
import { PERSONNEL_DOMAIN } from "@/lib/constants";

export type UserRow = {
  user_id: string; display_name: string; role: string; email: string | null; last_sign_in_at: string | null; created_at: string;
  logistics: boolean; site_access: boolean; boss: boolean; all_branches: boolean; employee_id: string | null; employee_name: string | null; department: string | null;
  user_type_id: string | null; user_type: string | null; type_color: string | null; type_levels: Record<string, number> | null; levels: Record<string, number>; explicit: Record<string, number>; flow_role: string | null;
};
export type TypeRow = { id: string; name: string; description: string | null; color: string; levels: Record<string, number>; scoped: boolean; site_access: boolean; boss: boolean; flow_role: string | null; sort: number; members: number; base_role: string };

export const ago = (d: string | null) => {
  if (!d) return "hiç giriş yapmadı";
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return "az önce";
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} saat önce`;
  const g = Math.floor(h / 24);
  return g === 1 ? "dün" : `${g} gün önce`;
};

export const loginLabel = (e: string | null) => (e ? (e.endsWith(`@${PERSONNEL_DOMAIN}`) ? `PDKS ${e.split("@")[0]}` : e) : "—");

export function Avatar({ name, color }: { name: string; color?: string | null }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toLocaleUpperCase("tr")).join("");
  return <span className="w-10 h-10 shrink-0 rounded-xl grid place-items-center text-sm font-bold text-white" style={{ background: color ?? "#94A3B8" }}>{ini || "?"}</span>;
}

export function TypeBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#C5D0DB] px-2.5 py-0.5 text-xs font-semibold text-muted">Türsüz</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: `${color ?? "#0A3D73"}1A`, color: color ?? "#0A3D73" }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: color ?? "#0A3D73" }} />{name}</span>;
}

/** Açık modüller: küçük haplar, seviye noktaları */
export function ModulePills({ levels, max = 13 }: { levels: Record<string, number>; max?: number }) {
  const on = MOD_INFO.filter((m) => (levels[m.key] ?? 0) > 0);
  if (!on.length) return <span className="text-xs text-muted">Yalnız kendi sayfası</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {on.slice(0, max).map((m) => (
        <span key={m.key} title={`${m.label}: ${m.levels[(levels[m.key] ?? 1) - 1]}`} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${LEVEL_CLS[levels[m.key] ?? 0]}`}>
          {m.label.split(" ")[0]}
          <span className="flex gap-px">{[1, 2, 3].map((i) => <span key={i} className={`w-1 h-1 rounded-full ${i <= (levels[m.key] ?? 0) ? "bg-current" : "bg-current opacity-25"}`} />)}</span>
        </span>
      ))}
      {on.length > max && <span className="text-[11px] text-muted self-center">+{on.length - max}</span>}
    </span>
  );
}

export function AdminTabs({ active, counts }: { active: string; counts: Record<string, number> }) {
  const tabs: [string, string][] = [["kullanicilar", "Kullanıcılar"], ["hesap-ac", "Hesap aç"], ["turler", "Kullanıcı türleri"], ["davetler", "Davet kodları"]];
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-[14px] bg-[#EEF2F6] p-1 text-sm font-semibold">
      {tabs.map(([k, l]) => (
        <Link key={k} href={`/yonetim?sekme=${k}`} className={`whitespace-nowrap rounded-[10px] px-4 py-2 transition ${active === k ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
          {l}{counts[k] ? <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${active === k ? "bg-brand-700 text-white" : "bg-white text-muted"}`}>{counts[k]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
