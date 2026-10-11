"use client";
import { useEffect, useRef, useState } from "react";

/** Tarayıcıda 3D tarama görüntüleyici: STL, PLY, OBJ. Döndür (sürükle), yakınlaştır (tekerlek / iki parmak), kaydır (sağ tık). */
export const MODEL_EXT = /\.(stl|ply|obj)$/i;

export function ModelViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset: () => void; wire: (on: boolean) => void; color: (c: string) => void } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [info, setInfo] = useState<string>("");
  const [wire, setWire] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        if (disposed || !host.current) return;
        const ext = (name.match(MODEL_EXT)?.[1] ?? "stl").toLowerCase();
        let geometries: import("three").BufferGeometry[] = [];
        let vertexColors = false;
        if (ext === "stl") {
          const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
          geometries = [new STLLoader().parse(buf)];
        } else if (ext === "ply") {
          const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
          const g = new PLYLoader().parse(buf);
          vertexColors = !!g.getAttribute("color");
          geometries = [g];
        } else {
          const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
          const grp = new OBJLoader().parse(new TextDecoder().decode(buf));
          grp.traverse((o) => { const m = o as unknown as { isMesh?: boolean; geometry?: import("three").BufferGeometry }; if (m.isMesh && m.geometry) geometries.push(m.geometry); });
        }
        if (!geometries.length) throw new Error("empty");

        const el = host.current;
        const w = el.clientWidth, h = el.clientHeight;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.setSize(w, h);
        renderer.setClearColor(0x1b2433);
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 5000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 1.6);
        camera.add(key);
        key.position.set(1, 1, 2);
        scene.add(camera);

        const material = new THREE.MeshStandardMaterial({ color: vertexColors ? 0xffffff : 0xe8dfcc, vertexColors, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
        const group = new THREE.Group();
        let tris = 0;
        for (const g of geometries) {
          if (!g.getAttribute("normal")) g.computeVertexNormals();
          tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
          group.add(new THREE.Mesh(g, material));
        }
        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        group.position.sub(center);
        scene.add(group);
        const radius = Math.max(size.x, size.y, size.z) || 10;
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        const reset = () => {
          camera.position.set(0, -radius * 0.4, radius * 2.2);
          camera.near = radius / 100;
          camera.far = radius * 50;
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
        };
        reset();
        setInfo(`${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm · ${Math.round(tris).toLocaleString("tr-TR")} üçgen`);
        api.current = { reset, wire: (on) => { material.wireframe = on; }, color: (c) => { material.color.set(c); } };

        let raf = 0;
        const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
        loop();
        const onResize = () => { const W = el.clientWidth, H = el.clientHeight; renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); };
        window.addEventListener("resize", onResize);
        setState("ready");
        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener("resize", onResize);
          controls.dispose();
          geometries.forEach((g) => g.dispose());
          material.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        if (!disposed) setState("error");
      }
    })();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    return () => { disposed = true; window.removeEventListener("keydown", onKey); cleanup(); };
  }, [url, name]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/80" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-white">
        <b className="min-w-0 flex-1 truncate">{name}</b>
        {info && <span className="text-xs text-white/70">{info}</span>}
        {state === "ready" && (
          <>
            {["#e8dfcc", "#f4f4f2", "#c9a27e", "#9fb4c7"].map((c) => (
              <button key={c} type="button" aria-label="Renk" onClick={() => api.current?.color(c)} className="h-7 w-7 rounded-full border-2 border-white/40" style={{ background: c }} />
            ))}
            <button type="button" onClick={() => { setWire(!wire); api.current?.wire(!wire); }} className="h-9 rounded-lg border border-white/30 px-3 text-sm font-semibold">{wire ? "Dolu" : "Tel kafes"}</button>
            <button type="button" onClick={() => api.current?.reset()} className="h-9 rounded-lg border border-white/30 px-3 text-sm font-semibold">Görünümü sıfırla</button>
          </>
        )}
        <a href={url} download={name} className="h-9 rounded-lg border border-white/30 px-3 text-sm font-semibold inline-flex items-center">İndir</a>
        <button type="button" onClick={onClose} className="h-9 rounded-lg bg-white px-3 text-sm font-bold text-black">Kapat</button>
      </div>
      <div ref={host} className="relative flex-1 touch-none">
        {state === "loading" && <p className="absolute inset-0 grid place-items-center text-white/80">Model yükleniyor…</p>}
        {state === "error" && <p className="absolute inset-0 grid place-items-center text-white/80">Model açılamadı. Dosyayı indirip CAD programında açın.</p>}
      </div>
      <p className="px-4 py-2 text-center text-xs text-white/60">Sürükle: döndür · Tekerlek / iki parmak: yakınlaştır · Sağ tık / üç parmak: kaydır</p>
    </div>
  );
}

/** "3D gör" düğmesi */
export function ModelButton({ url, name, className }: { url: string; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "font-semibold text-brand-700"}>3D gör</button>
      {open && <ModelViewer url={url} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
