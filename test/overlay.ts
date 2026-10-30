// Overlay-mode check: a site-like page with its own fixed background element; the canvas only adds the slab.
import { GlassSlab } from "../src/glass";
const bg = document.getElementById("bg") as HTMLCanvasElement;
const ctx = bg.getContext("2d")!;
bg.width = 1600; bg.height = 1000;
const g = ctx.createLinearGradient(0, 0, 1600, 0);
g.addColorStop(0, "#e4d3bd"); g.addColorStop(.4, "#d9c6ae"); g.addColorStop(.45, "#9fd8d0"); g.addColorStop(1, "#155a74");
ctx.fillStyle = g; ctx.fillRect(0, 0, 1600, 1000);
ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 6;
for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.moveTo(0, i * 36); ctx.lineTo(1600, i * 36 + 120); ctx.stroke(); }
const engine = new GlassSlab({
  canvas: document.getElementById("gl") as HTMLCanvasElement,
  host: document.getElementById("host")!, slab: document.getElementById("slab")!,
  mode: "overlay", background: bg, backgroundFit: "element",
  options: { view: "still", bubbles: 0.2 },
  onError: m => { (window as any).__errs.push(m); },
});
engine.start();
(window as any).__engine = engine;
