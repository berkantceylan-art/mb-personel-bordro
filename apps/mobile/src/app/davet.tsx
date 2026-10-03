import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Field, Notice, Screen } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { PERSONNEL_DOMAIN, WEB_URL, supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

type Preview = { company: string; role: string; display_name: string | null; login_email: string; valid: boolean };

export default function Invite() {
  const { reload } = useAuth();
  const [code, setCode] = useState("");
  const [p, setP] = useState<Preview | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("invite_preview", { p_code: code });
    setBusy(false);
    const v = data as Preview | null;
    if (error || !v) return setErr("Davet kodu bulunamadı.");
    if (!v.valid) return setErr("Bu davet kodu kullanılmış ya da süresi dolmuş.");
    setP(v);
  }

  async function register() {
    if (!p) return;
    if (pw.length < 6) return setErr("Şifre en az 6 karakter olmalı.");
    if (pw !== pw2) return setErr("Şifreler aynı değil.");
    setBusy(true);
    setErr(null);
    let problem: string | null = null;
    try {
      // 1) Sunucu hesabı hazırlar (e-posta onayı gerekmez, yarım kalan denemeyi düzeltir)
      const res = await fetch(`${WEB_URL}/api/davet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, password: pw }) });
      if (res.status === 501) {
        const { error } = await supabase.auth.signUp({ email: p.login_email, password: pw });
        if (error && !/registered|exists/i.test(error.message)) problem = error.message;
      } else if (!res.ok) {
        problem = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Hesap oluşturulamadı";
      }
    } catch {
      problem = "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.";
    }
    if (!problem) {
      const { error } = await supabase.auth.signInWithPassword({ email: p.login_email, password: pw });
      if (error) problem = /invalid login/i.test(error.message) ? "Bu kullanıcı adıyla daha önce farklı bir şifreyle hesap açılmış. Yöneticinize bildirin." : error.message;
    }
    if (problem) {
      setBusy(false);
      return setErr(problem);
    }
    const { error: c } = await supabase.rpc("claim_invite", { p_code: code });
    if (c) {
      setBusy(false);
      return setErr(c.message);
    }
    await reload();
    setBusy(false);
  }

  const login = p ? (p.login_email.endsWith(`@${PERSONNEL_DOMAIN}`) ? p.login_email.split("@")[0] : p.login_email) : "";

  return (
    <Screen>
      {!p ? (
        <Card title="Davet kodunuzu girin">
          <Text style={{ color: C.muted }}>Kod, işyerinizin verdiği davet kartında yazar.</Text>
          <Field label="Davet kodu" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={12} style={{ fontSize: 22, letterSpacing: 4, fontWeight: "700" }} />
          {err && <Notice ok={false} text={err} />}
          <Button title="Devam" onPress={check} busy={busy} disabled={code.length < 4} />
        </Card>
      ) : (
        <Card title={p.display_name ?? "Hoş geldiniz"}>
          <View style={{ backgroundColor: C.ground, borderRadius: 10, padding: 12, gap: 4 }}>
            <Text style={{ color: C.muted }}>{p.company}</Text>
            <Text>Kullanıcı adınız: <Text style={{ fontWeight: "800" }}>{login}</Text></Text>
          </View>
          <Field label="Şifre belirleyin" value={pw} onChangeText={setPw} secureTextEntry textContentType="newPassword" />
          <Field label="Şifre (tekrar)" value={pw2} onChangeText={setPw2} secureTextEntry textContentType="newPassword" />
          {err && <Notice ok={false} text={err} />}
          <Button title="Hesabı oluştur" onPress={register} busy={busy} />
        </Card>
      )}
    </Screen>
  );
}
