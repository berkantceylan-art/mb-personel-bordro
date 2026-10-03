import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button, Notice } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

export default function QrScan() {
  const [perm, requestPerm] = useCameraPermissions();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const lock = useRef(false);

  async function onScan(data: string) {
    if (lock.current) return;
    if (!data.startsWith("MBQR:")) return;
    lock.current = true;
    const { data: r, error } = await supabase.rpc("mobile_punch", { p_lat: null, p_lng: null, p_accuracy: null, p_qr: data });
    if (error) {
      setMsg({ ok: false, text: error.message });
      setTimeout(() => (lock.current = false), 2500);
      return;
    }
    const d = r as { direction: string; at: string; branch: string };
    setMsg({ ok: true, text: `${d.direction === "IN" ? "Giriş" : "Çıkış"} kaydedildi · ${d.at.slice(11, 16)} · ${d.branch}` });
    setTimeout(() => router.back(), 1600);
  }

  if (!perm) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!perm.granted) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 16 }}>
        <Text style={{ fontSize: 16, color: C.ink, textAlign: "center" }}>QR kodu okutmak için kamera izni gerekiyor.</Text>
        <Button title="Kameraya izin ver" onPress={requestPerm} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => onScan(data)} />
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
        <View style={{ width: 240, height: 240, borderWidth: 3, borderColor: C.accent, borderRadius: 24 }} />
      </View>
      <View style={{ position: "absolute", left: 16, right: 16, bottom: 32, gap: 10 }}>
        <Text style={{ color: C.white, textAlign: "center" }}>İşyerindeki ekranda görünen QR kodu çerçeveye getirin.</Text>
        {msg && <Notice ok={msg.ok} text={msg.text} />}
      </View>
    </View>
  );
}
