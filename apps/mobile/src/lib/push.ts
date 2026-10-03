import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

/** Expo Go'da uzaktan bildirim desteklenmez; modül hiç yüklenmez (uyarı da çıkmaz) */
export const pushSupported = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type N = typeof import("expo-notifications");
let mod: N | null = null;
async function load(): Promise<N | null> {
  if (!pushSupported) return null;
  if (!mod) {
    mod = await import("expo-notifications");
    mod.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  }
  return mod;
}

/** Bildirim izni alır, Expo push token'ını kaydeder. Geliştirme/mağaza derlemesinde çalışır. */
export async function registerPush(userId: string, companyId: string): Promise<string | null> {
  try {
    const Notifications = await load();
    if (!Notifications) return null;
    const Device = await import("expo-device");
    if (!Device.isDevice) return null;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "Genel", importance: Notifications.AndroidImportance.HIGH, lightColor: "#00A6D6" });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== "granted") return null;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from("push_tokens").upsert({ token, user_id: userId, company_id: companyId, platform: Platform.OS, updated_at: new Date().toISOString() });
    return token;
  } catch {
    return null;
  }
}

/** Bildirime dokunulunca bağlantıyı verir; aboneliği kaldıran fonksiyon döner */
export async function onNotificationTap(cb: (link: string | undefined) => void): Promise<() => void> {
  const Notifications = await load();
  if (!Notifications) return () => {};
  const last = Notifications.getLastNotificationResponse();
  if (last) cb(last.notification.request.content.data?.link as string | undefined);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => cb(r.notification.request.content.data?.link as string | undefined));
  return () => sub.remove();
}

export async function unregisterPush(token: string | null) {
  if (token) await supabase.from("push_tokens").delete().eq("token", token);
}
