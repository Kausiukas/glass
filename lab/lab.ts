/**
 * Carved Glass Lab: the tuning page. It drives the production engine only through its public API,
 * exactly as a site integration would.
 */
import { GlassSlab, DEFAULTS, LETTER_STYLES, SLAB_PRESETS, type GlassOptions } from "../src/glass";
// built separately and inlined as text so the single-file lab can start a blob: worker
import WORKER_SRC from "./worker-src.generated";

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll(s)) as T[];

const errEl = $("#err");
const report = (m: string) => { errEl.hidden = false; errEl.textContent = "Problem: " + String(m).slice(0, 220); };
addEventListener("error", e => report(e.message || "script error"));
addEventListener("unhandledrejection", e => report((e.reason && e.reason.message) || String(e.reason)));

const coarse = matchMedia("(pointer: coarse)").matches;
const opts: GlassOptions = { ...DEFAULTS, view: coarse ? "sway" : "pointer" };

const engine = new GlassSlab({
  canvas: $("#gl") as HTMLCanvasElement,
  host: $("#slabHost"),
  slab: $("#slab"),
  mode: "full",
  options: opts,
  background: "beach",
  createWorker: () => new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }))),
  onError: report,
  onStats: s => {
    $("#readout").textContent = s.webgl
      ? `${s.fps} fps · ${s.resolution.toFixed(2)}× res · relief ${s.reliefMs} ms · ${s.live ? "live" : "idle"}`
      : "no WebGL2";
  },
});
$("#engine").textContent = engine.ok ? "WebGL2 · ray-traced" : "Fallback: no WebGL2";
if (!engine.ok) document.documentElement.classList.add("no-gl");
engine.start();

/* ---------- generic control binding ---------- */
const FMT: Record<string, (v: number) => string> = {
  px: v => `${Math.round(v)} px`,
  deg: v => `${Math.round(v)}°`,
  pct: v => `${Math.round(v * 100)}%`,
  frost: v => `${Math.round(v * 100)}% frost`,
  matte: v => (v < 0.04 ? "polished" : `${Math.round(v * 100)}% matte`),
};
const ranges = $$<HTMLInputElement>("input[type=range][data-opt]");
const radioNames = Array.from(new Set($$<HTMLInputElement>(".dock input[type=radio]").map(i => i.name)));

function sync() {
  const o = engine.getOptions() as unknown as Record<string, unknown>;
  for (const el of ranges) {
    const k = parseFloat(el.dataset.k || "1"), v = o[el.id] as number;
    el.value = String(Math.round(v / k));
    const out = el.parentElement!.querySelector("output");
    if (out) out.textContent = FMT[el.dataset.fmt || "px"](v);
  }
  for (const name of radioNames) {
    const el = document.getElementById(`${name}-${o[name]}`) as HTMLInputElement | null;
    if (el) el.checked = true;
  }
}
for (const el of ranges) {
  el.addEventListener("input", () => {
    const v = +el.value * parseFloat(el.dataset.k || "1");
    engine.setOptions({ [el.id]: v } as Partial<GlassOptions>);
    const out = el.parentElement!.querySelector("output");
    if (out) out.textContent = FMT[el.dataset.fmt || "px"](v);
  });
}
for (const name of radioNames) {
  $$<HTMLInputElement>(`.dock input[name="${name}"]`).forEach(i => i.addEventListener("change", () => engine.setOptions({ [name]: i.value } as Partial<GlassOptions>)));
}
$$("[data-lstyle]").forEach(b => b.addEventListener("click", () => { engine.setOptions(LETTER_STYLES[b.dataset.lstyle as keyof typeof LETTER_STYLES]); sync(); }));
$$("[data-preset]").forEach(b => b.addEventListener("click", () => { engine.setOptions(SLAB_PRESETS[b.dataset.preset as keyof typeof SLAB_PRESETS]); sync(); }));
$$(".tab").forEach(tab => tab.addEventListener("click", () => {
  $$(".tab").forEach(t => { const on = t === tab; t.setAttribute("aria-selected", String(on)); $("#" + t.getAttribute("aria-controls")).hidden = !on; });
}));
sync();

/* ---------- headline: the engine notices text changes by itself ---------- */
let hlTimer = 0;
$<HTMLInputElement>("#headline").addEventListener("input", e => {
  clearTimeout(hlTimer);
  const v = (e.target as HTMLInputElement).value.trim() || "Sit Back. Let the Waves Carry Your Marketing.";
  hlTimer = window.setTimeout(() => { $("#slabH1").textContent = v; }, 140);
});

/* ---------- background ---------- */
let media: HTMLVideoElement | HTMLImageElement | null = null;
let paused = false;
const setOn = (beach: boolean) => { $("#bgBeach").classList.toggle("on", beach); $("#bgFileBtn").classList.toggle("on", !beach); };
$("#bgBeach").addEventListener("click", () => { engine.setBackground("beach", "viewport"); setOn(true); });
$<HTMLInputElement>("#bgFile").addEventListener("change", e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  if (media) { URL.revokeObjectURL(media.src); media.remove(); }
  const isVideo = f.type.startsWith("video/");
  const el = document.createElement(isVideo ? "video" : "img") as HTMLVideoElement | HTMLImageElement;
  el.className = "bg-media";
  if (el instanceof HTMLVideoElement) { el.muted = true; el.loop = true; el.playsInline = true; }
  el.src = URL.createObjectURL(f);
  el.addEventListener("error", () => report("That file could not be read as an image or video."));
  document.body.appendChild(el);
  media = el;
  if (el instanceof HTMLVideoElement && !paused) el.play().catch(err => report("Video would not play: " + err.message));
  engine.setBackground(el, "viewport");
  setOn(false);
});
$("#bgPause").addEventListener("click", () => {
  paused = !paused;
  $("#bgPause").setAttribute("aria-pressed", String(paused));
  $("#bgPause").textContent = paused ? "Play" : "Pause";
  engine.pauseBackground(paused);
  if (media instanceof HTMLVideoElement) paused ? media.pause() : media.play().catch(() => {});
});

/* ---------- phone tilt ---------- */
if (coarse) $("#tiltCtl").hidden = false;
$("#deviceTilt").addEventListener("click", async () => {
  const ok = await engine.enableDeviceTilt();
  if (ok) { engine.setOptions({ view: "pointer" }); sync(); $("#deviceTilt").textContent = "Tilting with phone"; }
  else report("The motion sensor is not available here (the Claude viewer blocks it; it works on your own site).");
});

/* ---------- still image ---------- */
$("#still").addEventListener("click", async () => {
  try {
    const blob = await engine.renderStill({ scale: 2, crop: "slab" });
    const url = URL.createObjectURL(blob);
    ($("#stillImg") as HTMLImageElement).src = url;
    ($("#stillDl") as HTMLAnchorElement).href = url;
    $("#stillModal").hidden = false;
  } catch (e) { report((e as Error).message); }
});
$("#stillClose").addEventListener("click", () => { $("#stillModal").hidden = true; });

(window as unknown as { __lab: unknown }).__lab = { engine };
