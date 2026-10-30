/**
 * Main-thread half of the relief builder: measures the real HTML text and buttons inside the slab
 * (with the slab's 3D transform temporarily removed) and rasterises anti-aliased masks.
 * It never modifies the DOM, so it is safe with React or any other framework.
 *
 * Markup contract (inside the slab element):
 *   [data-glass-carve]                 text that is chiselled into the glass
 *   [data-glass-carve][data-glass-small] small line: frosted print or chiselled (options.smallLine)
 *   [data-glass-button="1" | "2"]      raised glass button (1 = tinted main, 2 = secondary)
 *   [data-glass-label]                 inside a button: text frosted into its top (defaults to the button's text)
 */
import type { GlassOptions } from "./options";
import type { ButtonRect, ReliefInput } from "./reliefCore";

export interface ReliefRequest {
  input: ReliefInput;
  /** Texture rectangle in slab-local CSS px: [x, y, width, height]. */
  rect: [number, number, number, number];
}

interface Glyph { ch: string; x: number; y: number; h: number; style: string; weight: string; family: string; fs: number; }

function transformChar(ch: string, mode: string, prev: string): string {
  if (mode === "uppercase") return ch.toUpperCase();
  if (mode === "lowercase") return ch.toLowerCase();
  if (mode === "capitalize" && (prev === "" || /\s/.test(prev))) return ch.toUpperCase();
  return ch;
}

function collectGlyphs(root: Element, slabRect: DOMRect, out: Glyph[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    const cs = getComputedStyle(parent);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const fs = parseFloat(cs.fontSize);
    const text = node.textContent ?? "";
    let i = 0, prev = "";
    for (const ch of text) {
      const len = ch.length;
      if (!/\s/.test(ch)) {
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          out.push({
            ch: transformChar(ch, cs.textTransform, prev),
            x: r.left - slabRect.left, y: r.top - slabRect.top, h: r.height,
            style: cs.fontStyle, weight: cs.fontWeight, family: cs.fontFamily, fs,
          });
        }
      }
      prev = ch;
      i += len;
    }
  }
}

export function buildReliefRequest(slab: HTMLElement, o: GlassOptions, maxScale: number): ReliefRequest | null {
  const cutGlyphs: Glyph[] = [], printGlyphs: Glyph[] = [];
  const cssRects: { x: number; y: number; w: number; h: number; rad: number; id: number }[] = [];
  let fsMax = 10, W = 0, H = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;

  const prevTransform = slab.style.transform;
  slab.style.transform = "none";
  try {
    const sr = slab.getBoundingClientRect();
    W = sr.width; H = sr.height;
    if (W < 10 || H < 10) return null;
    const grow = (r: DOMRect) => {
      bx0 = Math.min(bx0, r.left - sr.left); by0 = Math.min(by0, r.top - sr.top);
      bx1 = Math.max(bx1, r.right - sr.left); by1 = Math.max(by1, r.bottom - sr.top);
    };
    slab.querySelectorAll<HTMLElement>("[data-glass-carve]").forEach(el => {
      const toPrint = el.hasAttribute("data-glass-small") && o.smallLine === "print";
      collectGlyphs(el, sr, toPrint ? printGlyphs : cutGlyphs);
      grow(el.getBoundingClientRect());
      if (!toPrint) fsMax = Math.max(fsMax, parseFloat(getComputedStyle(el).fontSize));
    });
    slab.querySelectorAll<HTMLElement>("[data-glass-button]").forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.width < 1) return;
      grow(r);
      cssRects.push({
        x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height,
        rad: parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0,
        id: Number(b.dataset.glassButton) === 2 ? 2 : 1,
      });
      collectGlyphs(b.querySelector("[data-glass-label]") ?? b, sr, printGlyphs);
    });
  } finally {
    slab.style.transform = prevTransform;
  }
  if (!isFinite(bx0)) return null;

  const pad = 22;
  const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad);
  const x1 = Math.min(W, bx1 + pad), y1 = Math.min(H, by1 + pad);
  let sc = Math.min(devicePixelRatio || 1, maxScale);
  const area = (x1 - x0) * (y1 - y0), cap = o.quality === "full" ? 1.8e6 : 1.2e6;
  if (area * sc * sc > cap) sc = Math.sqrt(cap / area);
  const tw = Math.max(2, Math.round((x1 - x0) * sc)), th = Math.max(2, Math.round((y1 - y0) * sc));
  const N = tw * th;

  const canvas = document.createElement("canvas");
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const raster = (glyphs: Glyph[]) => {
    ctx.clearRect(0, 0, tw, th);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "alphabetic";
    let font = "", asc = 0;
    for (const g of glyphs) {
      const f = `${g.style} ${g.weight} ${g.fs * sc}px ${g.family}`;
      if (f !== font) {
        font = f; ctx.font = f;
        const m = ctx.measureText("Hg");
        asc = m.fontBoundingBoxAscent ?? 0;
      }
      ctx.fillText(g.ch, (g.x - x0) * sc, (g.y - y0) * sc + (asc || g.h * sc * 0.75));
    }
    const d = ctx.getImageData(0, 0, tw, th).data;
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = d[i * 4 + 3] / 255;
    return a;
  };
  const cutA = raster(cutGlyphs);
  const printA = raster(printGlyphs);
  const rects: ButtonRect[] = cssRects.map(r => ({
    x: (r.x - x0) * sc, y: (r.y - y0) * sc, w: r.w * sc, h: r.h * sc, rad: r.rad * sc, id: r.id,
  }));

  return {
    input: {
      tw, th, sc, x0, y0, cutA, printA, fsMax, rects,
      params: {
        tool: o.tool, wallAngle: o.wallAngle, maxDepth: o.maxDepth, chips: o.chips, wobble: o.wobble,
        buttonHeight: o.buttonHeight, buttonShape: o.buttonShape, buttonEdge: o.buttonEdge,
      },
    },
    rect: [x0, y0, x1 - x0, y1 - y0],
  };
}
