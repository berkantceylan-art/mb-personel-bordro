import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Telefon bildirim izni alır ve Expo push token'ını kaydeder.
 * Expo Go'da (özellikle Android) uzaktan bildirim desteklenmez; geliştirme/mağaza derlemesinde çalışır.
 */
export async function registerPush(userId: string, companyId: string): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Genel",
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: "#00A6D6",
      });
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

export async function unregisterPush(token: string | null) {
  if (token) await supabase.from("push_tokens").delete().eq("token", token);
}
