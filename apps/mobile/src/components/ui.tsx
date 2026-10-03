import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { C } from "@/lib/theme";

export function Screen({ children, refreshing, onRefresh }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.ground }}
      contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.accent} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ title, right, children, style }: { title?: string; right?: React.ReactNode; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[s.card, style]}>
      {(title || right) && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {title ? <Text style={s.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Button({ title, onPress, kind = "primary", busy, disabled, style }: { title: string; onPress: () => void; kind?: "primary" | "accent" | "ghost" | "danger"; busy?: boolean; disabled?: boolean; style?: ViewStyle }) {
  const bg = kind === "primary" ? C.brand700 : kind === "accent" ? C.accent : kind === "danger" ? C.badBg : C.white;
  const fg = kind === "ghost" ? C.brand700 : kind === "danger" ? C.bad : C.white;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: pressed || busy || disabled ? 0.7 : 1, borderWidth: kind === "ghost" ? 1 : 0 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#9AA6B2" {...props} style={[s.input, props.multiline && { height: 96, textAlignVertical: "top", paddingTop: 10 }, props.style]} />
    </View>
  );
}

export function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function Notice({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={{ backgroundColor: ok ? C.okBg : C.badBg, borderRadius: 10, padding: 10 }} accessibilityLiveRegion="polite">
      <Text style={{ color: ok ? C.ok : C.bad, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function Row({ left, sub, right }: { left: string; sub?: string; right?: React.ReactNode }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.ink, fontSize: 15 }}>{left}</Text>
        {sub ? <Text style={{ color: C.muted, fontSize: 12 }}>{sub}</Text> : null}
      </View>
      {typeof right === "string" ? <Text style={{ color: C.ink, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{right}</Text> : right}
    </View>
  );
}

export const Empty = ({ text }: { text: string }) => <Text style={{ color: C.muted, textAlign: "center", paddingVertical: 12 }}>{text}</Text>;

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={[s.card, { flex: 1, minWidth: 150, gap: 4 }]}>
      <Text style={{ color: C.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: C.brand800, fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{value}</Text>
      {sub ? <Text style={{ color: C.muted, fontSize: 11 }}>{sub}</Text> : null}
    </View>
  );
}

export function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: "#E6ECF2", borderRadius: 10, padding: 3 }}>
      {options.map(([v, l]) => (
        <Pressable key={v} onPress={() => onChange(v)} accessibilityRole="tab" accessibilityState={{ selected: value === v }} style={{ flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: value === v ? C.white : "transparent", alignItems: "center" }}>
          <Text style={{ color: value === v ? C.brand700 : C.muted, fontWeight: value === v ? "700" : "500" }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.brand800 },
  btn: { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderColor: "#D5DEE8" },
  btnText: { fontSize: 16, fontWeight: "700" },
  label: { fontSize: 13, color: C.muted },
  input: { height: 48, borderRadius: 10, borderWidth: 1, borderColor: "#D5DEE8", paddingHorizontal: 12, backgroundColor: C.white, fontSize: 16, color: C.ink },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EEF2F6" },
});
