/**
 * Pure relief computation: no DOM, so it runs in a Web Worker or on the main thread.
 * Input: anti-aliased masks of the chiselled text and the frosted print, plus button rectangles.
 * Output: RGBA16F-ready height field (slope x, slope y, height z in CSS px, ambient occlusion)
 *         and an RGBA8 material map (cut weight, button id, frosted-print mask, button u or chip mask).
 */

export interface ButtonRect {
  /** Device-pixel rectangle inside the relief texture. */
  x: number; y: number; w: number; h: number; rad: number;
  /** 1 = main (tinted) button, 2 = secondary. */
  id: number;
}

export interface ReliefParams {
  tool: "gouge" | "vee" | "sand";
  wallAngle: number;
  maxDepth: number;
  chips: number;
  wobble: number;
  buttonHeight: number;
  buttonShape: "pillow" | "dome" | "bevel";
  buttonEdge: number;
}

export interface ReliefInput {
  tw: number; th: number;
  /** Texture pixels per CSS pixel. */
  sc: number;
  /** Top-left of the texture in slab-local CSS px (noise is anchored here so it does not swim). */
  x0: number; y0: number;
  cutA: Float32Array;
  printA: Float32Array;
  /** Largest font size among chiselled elements (CSS px). */
  fsMax: number;
  rects: ButtonRect[];
  params: ReliefParams;
}

export interface ReliefOutput {
  hf: Float32Array;
  mat: Uint8Array;
  /** Deepest cut in CSS px (sets the shader's search range). */
  deepest: number;
  tw: number; th: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth01 = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

function blurH(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let k = -r; k <= r; k++) acc += s[o + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) { d[o + x] = acc * inv; acc += s[o + Math.min(w - 1, x + r + 1)] - s[o + Math.max(0, x - r)]; }
  }
}
function blurV(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += s[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { d[y * w + x] = acc * inv; acc += s[Math.min(h - 1, y + r + 1) * w + x] - s[Math.max(0, y - r) * w + x]; }
  }
}
function blur3(a: Float32Array, w: number, h: number, r: number) {
  const t = new Float32Array(a.length), u = new Float32Array(a.length);
  let s = a;
  for (let i = 0; i < 3; i++) { blurH(s, t, w, h, r); blurV(t, u, w, h, r); s = u; }
  return u;
}

/** Exact Euclidean distance transform (Felzenszwalb & Huttenlocher). f: 0 on features, 1e12 elsewhere; returns squared distances in place. */
function edt1d(g: Float64Array, len: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0; v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (let q = 1; q < len; q++) {
    let s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + g[r]; }
}
function edt2d(f: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const g = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) g[y] = f[y * w + x]; edt1d(g, h, d, v, z); for (let y = 0; y < h; y++) f[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) g[x] = f[o + x]; edt1d(g, w, d, v, z); for (let x = 0; x < w; x++) f[o + x] = d[x]; }
}

/** Running max over a (2R+1)² window (van Herk / Gil-Werman): each stroke's local half-width. */
function maxFilter(src: Float32Array, w: number, h: number, R: number) {
  const W = 2 * R + 1, n = Math.max(w, h) + 2 * R;
  const pad = new Float32Array(n), g = new Float32Array(n), hh = new Float32Array(n);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const run = (len: number) => {
    const L = len + 2 * R;
    for (let i = 0; i < L; i++) g[i] = i % W === 0 ? pad[i] : Math.max(g[i - 1], pad[i]);
    for (let i = L - 1; i >= 0; i--) hh[i] = (i === L - 1 || (i + 1) % W === 0) ? pad[i] : Math.max(hh[i + 1], pad[i]);
  };
  for (let y = 0; y < h; y++) {
    const o = y * w; pad.fill(0, 0, w + 2 * R);
    for (let x = 0; x < w; x++) pad[x + R] = src[o + x];
    run(w);
    for (let x = 0; x < w; x++) tmp[o + x] = Math.max(hh[x], g[x + W - 1]);
  }
  for (let x = 0; x < w; x++) {
    pad.fill(0, 0, h + 2 * R);
    for (let y = 0; y < h; y++) pad[y + R] = tmp[y * w + x];
    run(h);
    for (let y = 0; y < h; y++) out[y * w + x] = Math.max(hh[y], g[y + W - 1]);
  }
  return out;
}

function hash2(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function computeRelief(inp: ReliefInput): ReliefOutput {
  const { tw, th, sc, x0, y0, cutA, printA, fsMax, rects, params } = inp;
  const N = tw * th;

  // 1) signed distance to the letter outline (device px) and each stroke's half-width
  const fA = new Float64Array(N), fB = new Float64Array(N);
  for (let i = 0; i < N; i++) { const ins = cutA[i] >= 0.5; fA[i] = ins ? 1e12 : 0; fB[i] = ins ? 0 : 1e12; }
  edt2d(fA, tw, th); edt2d(fB, tw, th);
  const sd = new Float32Array(N), dIn = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = cutA[i];
    let s = a >= 0.5 ? Math.sqrt(fA[i]) - 0.5 : -(Math.sqrt(fB[i]) - 0.5);
    if (a > 0 && a < 1 && Math.abs(s) < 1.2) s = a - 0.5;
    sd[i] = s; dIn[i] = s > 0 ? s : 0;
  }
  const wloc = maxFilter(dIn, tw, th, Math.max(2, Math.ceil(0.13 * fsMax * sc)));

  // 2) chisel profile + hand wobble + tool marks + conchoidal chips
  const tanA = Math.tan(params.wallAngle * Math.PI / 180), maxD = params.maxDepth;
  const wob = params.wobble, chips = params.chips, tool = params.tool;
  const csz = 3 + 5 * chips;
  const chipD = Math.min(maxD * 0.35, 0.5 + 1.5 * chips);
  const reach = (csz * 1.6 + 2) * sc;
  const hCut = new Float32Array(N), cutW = new Float32Array(N), chipW = new Float32Array(N);
  let deepest = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x;
    let s = sd[i];
    if (s < -reach) continue;
    const X = x / sc + x0, Y = y / sc + y0;
    if (wob > 0) s += wob * 0.75 * sc * ((vnoise(X / 7, Y / 7) - 0.5) * 2 + (vnoise(X / 2.6 + 31, Y / 2.6) - 0.5) * 0.8);
    let h = 0;
    if (s > 0) {
      const w = Math.max(wloc[i], 1), u = Math.min(s / w, 1), wc = w / sc;
      if (tool === "sand") {
        const D = maxD * 0.6, r = clamp((s / sc) * tanA / D, 0, 1);
        h = D * r * r * (3 - 2 * r);
      } else {
        let D = Math.min(maxD, tanA * wc);
        if (wob > 0) D *= 1 + wob * 0.3 * (vnoise(X / 34 + 7, Y / 34) - 0.5) * 2;
        h = tool === "gouge" ? D * (1 - (1 - u) * (1 - u)) : D * u;
        if (wob > 0) h += wob * 0.32 * (vnoise(X / 3.6 + 91, Y / 3.6) - 0.5) * 2 * 4 * u * (1 - u) * Math.min(D / 5, 1);
      }
      cutW[i] = Math.min(1, s + 0.5);
    }
    if (chips > 0) {
      const n1 = vnoise(X / (csz * 1.6) + 113, Y / (csz * 1.6) + 7);
      const m = smooth01((n1 - (1 - chips * 0.55)) / 0.06);
      if (m > 0) {
        const jag = 0.65 + 0.35 * vnoise(X / 1.3 + 57, Y / 1.3 + 3);
        const rch = csz * sc * (0.5 + 0.8 * n1) * jag;
        let hc = 0;
        if (s < 0) {
          const q = -s / rch;
          if (q < 1) hc = chipD * m * (1 - q * q * q) * (0.9 + 0.1 * Math.cos(q * 9 + n1 * 5));
        } else hc = chipD * m * (1 - smooth01(s / Math.max(rch, 1)));
        if (hc > h) { h = hc; chipW[i] = Math.min(1, hc / 0.5); cutW[i] *= 0.3; }
      }
    }
    hCut[i] = h;
    if (h > deepest) deepest = h;
  }

  // 3) raised buttons from the exact rounded-rectangle distance
  const zB = new Float32Array(N), bid = new Uint8Array(N), bu = new Float32Array(N);
  const Hb = params.buttonHeight, Bw = params.buttonEdge, shape = params.buttonShape;
  for (const r of rects) {
    const xa = Math.max(0, Math.floor(r.x - 1)), xb = Math.min(tw, Math.ceil(r.x + r.w + 1));
    const ya = Math.max(0, Math.floor(r.y - 1)), yb = Math.min(th, Math.ceil(r.y + r.h + 1));
    const halfH = r.h / 2 / sc, cx = r.x + r.w / 2, cy = r.y + r.h / 2, rr = Math.min(r.rad, r.w / 2, r.h / 2);
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const i = y * tw + x;
      const qx = Math.abs(x + 0.5 - cx) - r.w / 2 + rr, qy = Math.abs(y + 0.5 - cy) - r.h / 2 + rr;
      const sdist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
      const a = clamp(0.5 - sdist, 0, 1);
      if (a <= 0) continue;
      const d = Math.max(-sdist, 0) / sc;
      let z: number;
      if (shape === "dome") { const s = Math.min(d / halfH, 1); z = Hb * Math.sqrt(1 - (1 - s) * (1 - s)); }
      else if (shape === "bevel") z = Hb * Math.min(d / Bw, 1);
      else { const s = Math.min(d / Bw, 1); z = Hb * Math.sqrt(1 - (1 - s) * (1 - s)); }
      zB[i] = z * Math.min(1, a * 1.6);
      bid[i] = r.id === 1 ? 128 : 255;
      bu[i] = clamp((x - r.x) / r.w, 0, 1);
    }
  }

  // 4) combine, soften pixel stair-steps, slopes, ambient occlusion, materials
  const z = new Float32Array(N);
  for (let i = 0; i < N; i++) z[i] = zB[i] - hCut[i] - 0.6 * printA[i];
  const tmp = new Float32Array(N), zs = new Float32Array(N);
  blurH(z, tmp, tw, th, 1); blurV(tmp, zs, tw, th, 1);
  const zb = blur3(zs, tw, th, Math.max(2, Math.round(5 * sc)));
  const hf = new Float32Array(N * 4), mat = new Uint8Array(N * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x;
    const xl = x > 0 ? i - 1 : i, xr = x < tw - 1 ? i + 1 : i, yu = y > 0 ? i - tw : i, yd = y < th - 1 ? i + tw : i;
    hf[i * 4] = (zs[xr] - zs[xl]) * 0.5 * sc;
    hf[i * 4 + 1] = (zs[yd] - zs[yu]) * 0.5 * sc;
    hf[i * 4 + 2] = zs[i];
    hf[i * 4 + 3] = clamp(1 - 0.085 * Math.max(zb[i] - zs[i], 0), 0.5, 1);
    mat[i * 4] = Math.round(cutW[i] * 255);
    mat[i * 4 + 1] = bid[i];
    mat[i * 4 + 2] = Math.round(printA[i] * 255);
    mat[i * 4 + 3] = Math.round((bid[i] ? bu[i] : chipW[i]) * 255);
  }
  return { hf, mat, deepest, tw, th };
}
