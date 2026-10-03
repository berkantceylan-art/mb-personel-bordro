import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router/js-tabs";
import { isManager, useAuth } from "@/lib/auth";
import { useUnread } from "@/lib/hooks";
import { C } from "@/lib/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
const icon = (name: IconName) => ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const { profile } = useAuth();
  const unread = useUnread(profile?.userId);
  const manager = isManager(profile?.role);
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.brand900 },
        headerTintColor: C.white,
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: C.brand700,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Ana sayfa", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="maas" options={{ title: "Maaşım", tabBarIcon: icon("wallet-outline"), href: profile?.employee ? undefined : null }} />
      <Tabs.Screen name="talepler" options={{ title: "Talepler", tabBarIcon: icon("document-text-outline"), href: profile?.employee ? undefined : null }} />
      <Tabs.Screen name="mesajlar" options={{ title: "Mesajlar", tabBarIcon: icon("chatbubbles-outline"), tabBarBadge: unread.messages || undefined }} />
      <Tabs.Screen name="yonetim" options={{ title: "Yönetim", tabBarIcon: icon("briefcase-outline"), href: manager ? undefined : null }} />
      <Tabs.Screen name="profil" options={{ title: "Profil", tabBarIcon: icon("person-circle-outline"), tabBarBadge: unread.notifications || undefined }} />
    </Tabs>
  );
}
