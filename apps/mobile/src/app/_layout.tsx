import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, isManager, useAuth } from "@/lib/auth";
import { appRoute } from "@/lib/format";
import { onNotificationTap, registerPush } from "@/lib/push";
import { configured } from "@/lib/supabase";
import { C } from "@/lib/theme";

function Gate() {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const pushed = useRef(false);

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "giris" || segments[0] === "davet";
    if (!session || !profile) {
      if (!inAuth) router.replace("/giris");
    } else if (inAuth) {
      router.replace("/");
    }
  }, [session, profile, loading, segments, router]);

  // Bildirim izni + token kaydı
  useEffect(() => {
    if (profile && !pushed.current) {
      pushed.current = true;
      registerPush(profile.userId, profile.companyId);
    }
  }, [profile]);

  // Bildirime dokununca ilgili ekrana git
  useEffect(() => {
    if (!profile) return;
    let off = () => {};
    onNotificationTap((link) => router.push(appRoute(link, isManager(profile.role)) as never)).then((f) => (off = f));
    return () => off();
  }, [profile, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.brand900 }}>
        <ActivityIndicator color={C.white} size="large" />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: C.brand900 },
        headerTintColor: C.white,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: C.ground },
        headerBackTitle: "Geri",
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="giris" options={{ headerShown: false }} />
      <Stack.Screen name="davet" options={{ title: "Hesap oluştur" }} />
      <Stack.Screen name="qr" options={{ title: "QR ile okut", presentation: "modal" }} />
      <Stack.Screen name="mesaj/[id]" options={{ title: "Mesaj" }} />
      <Stack.Screen name="duyurular" options={{ title: "Duyurular" }} />
      <Stack.Screen name="bildirimler" options={{ title: "Bildirimler" }} />
      <Stack.Screen name="yeni-duyuru" options={{ title: "Yeni duyuru", presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  if (!configured) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontSize: 16, textAlign: "center" }}>
          Supabase ayarları eksik. apps/mobile/.env dosyasına EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY yazın, sonra uygulamayı yeniden başlatın.
        </Text>
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
