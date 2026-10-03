import { Link } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Button, Field, Notice, s } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { supabase, toLogin } from "@/lib/supabase";
import { C } from "@/lib/theme";

export default function Login() {
  const { reload } = useAuth();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: toLogin(user), password });
    if (error) {
      setBusy(false);
      return setErr("Kullanıcı adı veya şifre hatalı.");
    }
    await reload();
    setBusy(false);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: C.brand900, justifyContent: "center", padding: 20 }}>
      <View style={[s.card, { gap: 16, padding: 24 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Image source={require("../../assets/logo.png")} style={{ width: 52, height: 46 }} resizeMode="contain" accessibilityIgnoresInvertColors />
          <View>
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.brand800 }}>MB DENTAL</Text>
            <Text style={{ color: C.muted }}>Personel uygulaması</Text>
          </View>
        </View>
        <Field label="Kullanıcı adı (PDKS no) veya e-posta" value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false} textContentType="username" />
        <Field label="Şifre" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" onSubmitEditing={submit} />
        {err && <Notice ok={false} text={err} />}
        <Button title="Giriş yap" onPress={submit} busy={busy} disabled={!user || !password} />
        <Link href="/davet" style={{ textAlign: "center", color: C.brand700, fontWeight: "700", paddingVertical: 6 }}>
          Davet kodum var · hesap oluştur
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}
