import { router } from "expo-router";
import { Text, View } from "react-native";
import { Button, Card, Row, Screen } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { C } from "@/lib/theme";

const ROLE: Record<string, string> = { owner: "Şirket sahibi", accountant: "Muhasebe", hr: "İnsan kaynakları", branch_manager: "Şube sorumlusu", safety: "İSG uzmanı", employee: "Personel" };

export default function ProfileScreen() {
  const { profile, session, signOut } = useAuth();
  const e = profile?.employee;
  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.brand700, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: C.white, fontSize: 20, fontWeight: "800" }}>{(profile?.displayName ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.brand800 }}>{profile?.displayName}</Text>
            <Text style={{ color: C.muted }}>{ROLE[profile?.role ?? "employee"]} · {profile?.companyName}</Text>
          </View>
        </View>
        {e && <Row left="Bölüm" right={e.department ?? "—"} />}
        {e && <Row left="Şube" right={e.branch ?? "—"} />}
        {e?.card_no && <Row left="PDKS no" right={e.card_no} />}
        <Row left="Kullanıcı" right={session?.user.email?.replace("@personel.mbdental.app", "") ?? ""} />
      </Card>
      <Button title="Bildirimler" kind="ghost" onPress={() => router.push("/bildirimler")} />
      <Button title="Duyurular" kind="ghost" onPress={() => router.push("/duyurular")} />
      <Button title="Çıkış yap" kind="danger" onPress={signOut} />
      <Text style={{ color: C.muted, textAlign: "center", fontSize: 12 }}>Kişisel bilgilerinizdeki değişiklikler için İK ile iletişime geçin.</Text>
    </Screen>
  );
}
