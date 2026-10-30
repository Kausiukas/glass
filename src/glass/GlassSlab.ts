/**
 * GlassSlab: a ray-traced glass slab with chiselled letters and raised glass buttons, drawn with WebGL2
 * behind (or over) ordinary HTML. Framework-agnostic; see GlassHero.tsx for the React wrapper.
 *
 *   canvas  position:fixed; inset:0; pointer-events:none  (the engine sizes its drawing buffer)
 *   host    untransformed box that defines where the slab sits
 *   slab    child of host, same size; the engine applies perspective()/rotate() to it each frame
 *
 * mode "full":    the canvas draws the background too (demo / when you have no background element).
 * mode "overlay": the canvas is transparent except the slab, its shadow and caustics; your own
 *                 <video>/<img> stays visible underneath and is also used as the refraction source.
 */
import { VS, COPY_FS, BEACH_FS, SLAB_FS } from "./shaders";
import { ABSORB, DEFAULTS, MAIN_TINT, RELIEF_KEYS, type GlassOptions } from "./options";
import { buildReliefRequest } from "./relief";
import { computeRelief, type ReliefOutput } from "./reliefCore";

export type BackgroundSource = "beach" | HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
/** element: map the texture onto the element's on-screen box (object-fit: cover). viewport: cover the viewport. */
export type BackgroundFit = "element" | "viewport";

export interface GlassStats {
  fps: number;
  /** Device pixels per CSS pixel currently rendered. */
  resolution: number;
  /** Time of the last relief rebuild (ms). */
  reliefMs: number;
  /** True while frames are being drawn; false when idle (nothing changed). */
  live: boolean;
  webgl: boolean;
  tiltX: number;
  tiltY: number;
}

export interface GlassSlabInit {
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  slab: HTMLElement;
  /** Fixed for the lifetime of the instance (it decides the canvas alpha mode). Default "full". */
  mode?: "full" | "overlay";
  options?: Partial<GlassOptions>;
  background?: BackgroundSource;
  backgroundFit?: BackgroundFit;
  /** Supply to build the relief off the main thread; without it the relief is computed synchronously. */
  createWorker?: () => Worker;
  onStats?: (s: GlassStats) => void;
  onError?: (message: string) => void;
}

interface Prog { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; }
interface BtnState { hover: boolean; press: boolean; s: number; }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Prog {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "a"); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program link failed");
  const u: Prog["u"] = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i)!; u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

/** CSS rotateX(rx) · rotateY(ry) as a column-major mat3 (CSS axes: x right, y down, z toward the viewer). */
function rotMat(rx: number, ry: number): Float32Array {
  const a = rx * Math.PI / 180, b = ry * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const X = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]];
  const Y = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]];
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) M[i][j] += X[i][k] * Y[k][j];
  return new Float32Array([M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]]);
}

export class GlassSlab {
  readonly canvas: HTMLCanvasElement;
  readonly host: HTMLElement;
  readonly slab: HTMLElement;
  readonly mode: "full" | "overlay";
  /** False when WebGL2 is unavailable; the host then carries data-glass="off" for CSS fallbacks. */
  ok = false;

  private o: GlassOptions;
  private gl: WebGL2RenderingContext | null = null;
  private progs: { copy: Prog; beach: Prog; slab: Prog } | null = null;
  private tex: { beach: WebGLTexture; media: WebGLTexture; hf: WebGLTexture; mat: WebGLTexture } | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private vbo: WebGLBuffer | null = null;
  private bgW = 2; private bgH = 2;
  private bgSource: BackgroundSource = "beach";
  private bgFit: BackgroundFit = "viewport";
  private bgDirty = true; private bgPaused = false; private mediaReady = false;
  private hasVFC = false; private videoFrameNew = true; private vfcVideo: HTMLVideoElement | null = null; private vfcHandle = 0;
  private relief: ReliefOutput | null = null; private reliefRect: [number, number, number, number] = [0, 0, 1, 1];
  private zBot = -16; private reliefMs = 0;
  private worker: Worker | null = null; private jobId = 0; private busy = false; private pending = false;
  private jobRect: [number, number, number, number] = [0, 0, 1, 1]; private jobT0 = 0; private reliefTimer = 0;
  private ppc = 1.5; private calmUntil = 0; private slow = 0; private fast = 0;
  private raf = 0; private running = false; private lost = false; private dirty = true; private live = false;
  private tilt = { rx: 0, ry: 0 }; private lastTransform = "";
  private pointer = { x: 0, y: 0, active: false };
  private orient: { nx: number; ny: number; at: number } | null = null;
  private btn: Record<1 | 2, BtnState> = { 1: { hover: false, press: false, s: 1 }, 2: { hover: false, press: false, s: 1 } };
  private visible = true; private lastHost = ""; private parked = false;
  private frames = 0; private fpsT = 0; private fps = 0; private statsT = 0;
  private reduced: boolean;
  private cleanup: (() => void)[] = [];
  private onStats?: (s: GlassStats) => void;
  private onError?: (m: string) => void;

  constructor(init: GlassSlabInit) {
    this.canvas = init.canvas; this.host = init.host; this.slab = init.slab;
    this.mode = init.mode ?? "full";
    this.o = { ...DEFAULTS, ...init.options };
    this.onStats = init.onStats; this.onError = init.onError;
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.bgPaused = this.reduced && this.o.respectReducedMotion;
    this.tilt = { rx: this.o.restTilt[0], ry: this.o.restTilt[1] };
    if (init.createWorker) {
      try {
        this.worker = init.createWorker();
        this.worker.onmessage = this.onWorker;
        this.worker.onerror = () => { this.worker?.terminate(); this.worker = null; this.busy = false; this.scheduleRelief(0); };
      } catch { this.worker = null; }
    }
    this.ok = this.initGL();
    this.host.dataset.glass = this.ok ? "on" : "off";
    this.bindEvents();
    this.setBackground(init.background ?? "beach", init.backgroundFit ?? (this.mode === "overlay" ? "element" : "viewport"));
    if (this.ok) { this.ppc = this.maxPPC(); this.calmUntil = performance.now() + 3000; this.resize(); }
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(() => this.scheduleRelief(0)); else this.scheduleRelief(0);
  }

  // ───────────────────────── public API ─────────────────────────

  start() { if (this.running) return; this.running = true; this.raf = requestAnimationFrame(this.frame); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  getOptions(): GlassOptions { return { ...this.o, restTilt: [...this.o.restTilt], maxTilt: [...this.o.maxTilt] }; }

  setOptions(p: Partial<GlassOptions>) {
    let relief = false;
    for (const k of Object.keys(p) as (keyof GlassOptions)[]) {
      if (p[k] === undefined) continue;
      if (JSON.stringify(this.o[k]) !== JSON.stringify(p[k]) && RELIEF_KEYS.includes(k)) relief = true;
    }
    const qualityChanged = p.quality !== undefined && p.quality !== this.o.quality;
    this.o = { ...this.o, ...p };
    if (qualityChanged) { this.ppc = this.maxPPC(); this.slow = this.fast = 0; this.calmUntil = performance.now() + 2500; this.resize(); }
    if (relief) this.scheduleRelief(30);
    this.dirty = true;
  }

  setBackground(src: BackgroundSource, fit?: BackgroundFit) {
    if (this.vfcVideo && this.vfcHandle) (this.vfcVideo as HTMLVideoElement & { cancelVideoFrameCallback?(h: number): void }).cancelVideoFrameCallback?.(this.vfcHandle);
    this.vfcVideo = null; this.vfcHandle = 0; this.hasVFC = false;
    this.bgSource = src;
    if (fit) this.bgFit = fit;
    this.mediaReady = false; this.bgDirty = true; this.dirty = true;
    if (src instanceof HTMLVideoElement) {
      const v = src as HTMLVideoElement & { requestVideoFrameCallback?(cb: () => void): number };
      if (typeof v.requestVideoFrameCallback === "function") {
        // upload only when the video actually presents a new frame (often 25–30 fps instead of every display frame)
        this.hasVFC = true; this.vfcVideo = src;
        const cb = () => { this.videoFrameNew = true; this.vfcHandle = v.requestVideoFrameCallback!(cb); };
        this.vfcHandle = v.requestVideoFrameCallback(cb);
      }
      src.addEventListener("loadeddata", () => { this.bgDirty = true; this.dirty = true; }, { once: true });
    } else if (src instanceof HTMLImageElement && !src.complete) {
      src.addEventListener("load", () => { this.bgDirty = true; this.dirty = true; }, { once: true });
    }
  }

  /** Freeze or resume the built-in demo beach animation. */
  pauseBackground(paused: boolean) { this.bgPaused = paused; this.dirty = true; }

  /** Rebuild the relief now (it also rebuilds automatically on text, size and font changes). */
  rebuildRelief() { this.scheduleRelief(0); }

  /** Phones: tilt with the device. iOS needs this to be called from a user gesture. Returns false if refused. */
  async enableDeviceTilt(): Promise<boolean> {
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === "function") {
      try { if ((await D.requestPermission()) !== "granted") return false; } catch { return false; }
    }
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      this.orient = { ny: clamp((e.beta - 45) / 25, -1.2, 1.2), nx: clamp(e.gamma / 25, -1.2, 1.2), at: performance.now() };
    };
    window.addEventListener("deviceorientation", on);
    this.cleanup.push(() => window.removeEventListener("deviceorientation", on));
    return true;
  }

  /**
   * Render a high-resolution still (for a poster image, social preview or the no-WebGL fallback).
   * crop "slab" returns the slab plus shadow margin; in overlay mode the PNG has transparency.
   */
  async renderStill(opts: { scale?: number; crop?: "slab" | "viewport"; margin?: number } = {}): Promise<Blob> {
    if (!this.ok || !this.gl) throw new Error("WebGL2 is not available");
    const prev = this.ppc;
    this.ppc = Math.min(4, (devicePixelRatio || 1) * clamp(opts.scale ?? 2, 1, 3));
    this.resize();
    const r = this.host.getBoundingClientRect();
    this.draw(performance.now(), r);
    const [VW, VH] = this.viewSize();
    const pr = this.canvas.width / VW;
    const out = document.createElement("canvas");
    if ((opts.crop ?? "slab") === "slab") {
      const m = opts.margin ?? 90;
      const x0 = clamp(r.left - m, 0, VW), y0 = clamp(r.top - m, 0, VH), x1 = clamp(r.right + m, 0, VW), y1 = clamp(r.bottom + m, 0, VH);
      out.width = Math.round((x1 - x0) * pr); out.height = Math.round((y1 - y0) * pr);
      out.getContext("2d")!.drawImage(this.canvas, x0 * pr, y0 * pr, out.width, out.height, 0, 0, out.width, out.height);
    } else {
      out.width = this.canvas.width; out.height = this.canvas.height;
      out.getContext("2d")!.drawImage(this.canvas, 0, 0);
    }
    this.ppc = prev; this.resize(); this.dirty = true;
    return new Promise((res, rej) => out.toBlob(b => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  }

  dispose() {
    this.stop();
    clearTimeout(this.reliefTimer);
    this.cleanup.forEach(f => f()); this.cleanup = [];
    this.setBackground("beach");
    this.worker?.terminate(); this.worker = null;
    const gl = this.gl;
    if (gl && this.tex && this.progs) {
      Object.values(this.tex).forEach(t => gl.deleteTexture(t));
      Object.values(this.progs).forEach(p => gl.deleteProgram(p.p));
      gl.deleteFramebuffer(this.fbo); gl.deleteBuffer(this.vbo);
    }
    this.slab.style.transform = "";
    delete this.host.dataset.glass;
  }

  // ───────────────────────── setup ─────────────────────────

  private err(m: string) { if (this.onError) this.onError(m); else console.warn("[GlassSlab]", m); }

  private initGL(): boolean {
    try {
      const attrs: WebGLContextAttributes = this.mode === "overlay"
        ? { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "high-performance" }
        : { alpha: false, antialias: false, powerPreference: "high-performance" };
      const gl = this.canvas.getContext("webgl2", attrs);
      if (!gl) throw new Error("WebGL2 is not available in this browser");
      this.gl = gl;
      this.progs = { copy: compile(gl, VS, COPY_FS), beach: compile(gl, VS, BEACH_FS), slab: compile(gl, VS, SLAB_FS) };
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const mk = (minFilter: number) => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        return t;
      };
      this.tex = { beach: mk(gl.LINEAR_MIPMAP_LINEAR), media: mk(gl.LINEAR_MIPMAP_LINEAR), hf: mk(gl.LINEAR), mat: mk(gl.LINEAR) };
      gl.bindTexture(gl.TEXTURE_2D, this.tex.media);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.hf);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([0, 0, 0, 1]));
      gl.bindTexture(gl.TEXTURE_2D, this.tex.mat);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      this.fbo = gl.createFramebuffer();
      if (this.relief) this.uploadRelief(this.relief);
      this.bgDirty = true; this.dirty = true;
      return true;
    } catch (e) {
      this.err((e as Error).message);
      return false;
    }
  }

  private bindEvents() {
    const on = (t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn, opts));
    };
    const setPointer = (e: Event) => { const p = e as PointerEvent; this.pointer.x = p.clientX; this.pointer.y = p.clientY; this.pointer.active = true; };
    on(window, "pointermove", setPointer, { passive: true });
    on(window, "pointerdown", setPointer, { passive: true });
    on(document.documentElement, "mouseleave", () => { this.pointer.active = false; });
    on(window, "blur", () => { this.pointer.active = false; });
    on(window, "resize", () => { this.resize(); this.scheduleRelief(); });
    on(this.canvas, "webglcontextlost", e => { e.preventDefault(); this.lost = true; });
    on(this.canvas, "webglcontextrestored", () => { this.lost = false; this.ok = this.initGL(); this.host.dataset.glass = this.ok ? "on" : "off"; this.resize(); });
    on(document, "visibilitychange", () => { this.dirty = true; });
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) on(fonts, "loadingdone", () => this.scheduleRelief());

    // buttons, by delegation so re-rendered markup keeps working
    const btnOf = (e: Event) => (e.target as Element | null)?.closest?.("[data-glass-button]") as HTMLElement | null;
    const st = (b: HTMLElement) => this.btn[b.dataset.glassButton === "2" ? 2 : 1];
    on(this.slab, "pointerover", e => { const b = btnOf(e); if (b) st(b).hover = true; });
    on(this.slab, "pointerout", e => {
      const b = btnOf(e); if (!b) return;
      const rel = (e as PointerEvent).relatedTarget as Node | null;
      if (!rel || !b.contains(rel)) { st(b).hover = false; st(b).press = false; }
    });
    on(this.slab, "pointerdown", e => { const b = btnOf(e); if (b) st(b).press = true; });
    on(window, "pointerup", () => { this.btn[1].press = false; this.btn[2].press = false; });
    on(this.slab, "focusin", e => { const b = btnOf(e); if (b) st(b).hover = true; });
    on(this.slab, "focusout", e => { const b = btnOf(e); if (b) st(b).hover = false; });
    on(this.slab, "keydown", e => {
      const k = (e as KeyboardEvent).key, b = btnOf(e);
      if (b && (k === "Enter" || k === " ")) { st(b).press = true; setTimeout(() => { st(b).press = false; }, 160); }
    });

    const ro = new ResizeObserver(() => { this.scheduleRelief(); this.dirty = true; });
    ro.observe(this.slab);
    const mo = new MutationObserver(() => this.scheduleRelief());
    mo.observe(this.slab, { subtree: true, childList: true, characterData: true });
    const io = new IntersectionObserver(es => { this.visible = es[es.length - 1].isIntersecting; this.dirty = true; }, { rootMargin: "200px" });
    io.observe(this.host);
    this.cleanup.push(() => { ro.disconnect(); mo.disconnect(); io.disconnect(); });
  }

  private maxPPC() { return Math.min(devicePixelRatio || 1, this.o.quality === "full" ? 2 : 1.5); }
  private minPPC() { return Math.min(this.maxPPC(), 0.8); }
  private viewSize(): [number, number] {
    return [this.canvas.clientWidth || document.documentElement.clientWidth, this.canvas.clientHeight || document.documentElement.clientHeight];
  }

  private resize() {
    const gl = this.gl;
    if (!gl || !this.tex) return;
    const [w, h] = this.viewSize();
    this.canvas.width = Math.max(2, Math.round(w * this.ppc));
    this.canvas.height = Math.max(2, Math.round(h * this.ppc));
    const dpr = devicePixelRatio || 1;
    this.bgW = Math.max(2, Math.round(w * Math.min(dpr, 1.5) * 0.6));
    this.bgH = Math.max(2, Math.round(h * Math.min(dpr, 1.5) * 0.6));
    gl.bindTexture(gl.TEXTURE_2D, this.tex.beach);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.bgW, this.bgH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.beach, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bgDirty = true; this.dirty = true;
  }

  // ───────────────────────── relief ─────────────────────────

  private scheduleRelief(delay = 110) {
    clearTimeout(this.reliefTimer);
    this.reliefTimer = window.setTimeout(() => this.runRelief(), delay);
  }

  private runRelief() {
    if (this.busy) { this.pending = true; return; }
    let req;
    try { req = buildReliefRequest(this.slab, this.o, this.maxPPC()); }
    catch (e) { this.err("Relief measure: " + (e as Error).message); return; }
    if (!req) return;
    const id = ++this.jobId, t0 = performance.now();
    if (this.worker) {
      this.busy = true; this.jobRect = req.rect; this.jobT0 = t0;
      this.worker.postMessage({ id, input: req.input }, [req.input.cutA.buffer, req.input.printA.buffer]);
    } else {
      try { this.applyRelief(computeRelief(req.input), req.rect, t0); }
      catch (e) { this.err("Relief build: " + (e as Error).message); }
    }
  }

  private onWorker = (e: MessageEvent<{ id: number; out?: ReliefOutput; error?: string }>) => {
    this.busy = false;
    const { id, out, error } = e.data;
    if (error) this.err("Relief worker: " + error);
    else if (out && id === this.jobId) this.applyRelief(out, this.jobRect, this.jobT0);
    if (this.pending) { this.pending = false; this.runRelief(); }
  };

  private applyRelief(out: ReliefOutput, rect: [number, number, number, number], t0: number) {
    this.relief = out; this.reliefRect = rect;
    this.zBot = -(out.deepest + 2);
    this.uploadRelief(out);
    this.reliefMs = Math.round(performance.now() - t0);
    this.calmUntil = performance.now() + 1500;
    this.dirty = true;
  }

  private uploadRelief(out: ReliefOutput) {
    const gl = this.gl;
    if (!gl || !this.tex) return;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.hf);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, out.tw, out.th, 0, gl.RGBA, gl.FLOAT, out.hf);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.mat);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, out.tw, out.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, out.mat);
  }

  // ───────────────────────── frame loop ─────────────────────────

  private effectiveView() { return this.reduced && this.o.respectReducedMotion ? "still" : this.o.view; }

  private targetTilt(t: number, r: DOMRect) {
    const [rx0, ry0] = this.o.restTilt, [mx, my] = this.o.maxTilt;
    const view = this.effectiveView();
    if (view === "sway") return { rx: rx0 - 3 + 6 * Math.sin(t * 0.00052), ry: ry0 + 10 + 15 * Math.sin(t * 0.00031) };
    if (view === "pointer") {
      if (this.orient && performance.now() - this.orient.at < 1500) return { rx: this.orient.ny * mx, ry: -this.orient.nx * my };
      if (this.pointer.active) {
        const nx = clamp((this.pointer.x - (r.left + r.width / 2)) / (r.width * 0.55), -1.25, 1.25);
        const ny = clamp((this.pointer.y - (r.top + r.height / 2)) / (r.height * 0.75), -1.25, 1.25);
        return { rx: ny * mx, ry: -nx * my };
      }
    }
    return { rx: rx0, ry: ry0 };
  }

  private frame = (t: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    this.frames++;
    if (t - this.fpsT > 1000) {
      this.fps = Math.round(this.frames * 1000 / (t - this.fpsT)); this.frames = 0; this.fpsT = t;
      // adaptive resolution: ignore start-up and relief rebuilds, step down only after sustained slowness
      if (this.ok && this.o.quality === "auto" && this.live && t > this.calmUntil) {
        this.slow = this.fps < 30 ? this.slow + 1 : 0;
        this.fast = this.fps > 55 ? this.fast + 1 : 0;
        if (this.slow >= 2 && this.ppc > this.minPPC()) { this.ppc = Math.max(this.minPPC(), this.ppc * 0.85); this.slow = 0; this.resize(); }
        else if (this.fast >= 3 && this.ppc < this.maxPPC()) { this.ppc = Math.min(this.maxPPC(), this.ppc * 1.12); this.fast = 0; this.resize(); }
      }
    }

    const r = this.host.getBoundingClientRect();
    const tg = this.targetTilt(t, r);
    const k = this.effectiveView() === "pointer" && (this.pointer.active || this.orient) ? 0.14 : 0.06;
    const rx = lerp(this.tilt.rx, tg.rx, k), ry = lerp(this.tilt.ry, tg.ry, k);
    const moving = Math.abs(rx - this.tilt.rx) + Math.abs(ry - this.tilt.ry) > 0.003;
    this.tilt = { rx, ry };
    const tr = `perspective(${this.o.camera}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    if (tr !== this.lastTransform) { this.slab.style.transform = tr; this.lastTransform = tr; }

    let btnMoving = false;
    for (const id of [1, 2] as const) {
      const b = this.btn[id];
      const target = b.press ? 0.4 : b.hover ? 1.25 : 1;
      const ns = lerp(b.s, target, 0.22);
      if (Math.abs(ns - b.s) > 1e-3) btnMoving = true;
      b.s = Math.abs(ns - target) < 1e-3 ? target : ns;
    }

    const hostKey = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`;
    const moved = hostKey !== this.lastHost; this.lastHost = hostKey;
    const src = this.bgSource;
    const beachLive = src === "beach" && !this.bgPaused;
    const videoLive = src instanceof HTMLVideoElement && !src.paused && (!this.hasVFC || this.videoFrameNew);
    // overlay mode with the slab scrolled away: clear once, then do nothing (no video uploads) until it returns
    const offscreen = !this.visible || r.bottom < -200 || r.top > this.viewSize()[1] + 200;
    const need = this.mode === "overlay" && offscreen
      ? !this.parked
      : this.dirty || moving || btnMoving || moved || beachLive || videoLive || this.bgDirty;
    this.live = need;
    if (need && this.ok && !this.lost && document.visibilityState !== "hidden") {
      // clear the flags first: anything that asks for another frame during the draw (e.g. an onError
      // handler calling setBackground) must not be lost
      this.dirty = false; this.videoFrameNew = false;
      try { this.draw(t, r); } catch (e) { this.err("Render: " + (e as Error).message); }
    }
    if (this.onStats && t - this.statsT > 250) {
      this.statsT = t;
      this.onStats({ fps: this.fps, resolution: this.ppc, reliefMs: this.reliefMs, live: this.live, webgl: this.ok, tiltX: rx, tiltY: ry });
    }
  };

  private draw(t: number, r: DOMRect) {
    const gl = this.gl!, P = this.progs!, T = this.tex!;
    const [VW, VH] = this.viewSize();
    const o = this.o;

    if (this.mode === "overlay" && (!this.visible || r.bottom < -200 || r.top > VH + 200)) {
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this.parked = true;
      return;
    }
    this.parked = false;

    // 1) background texture + its on-screen mapping
    let bgTex = T.beach;
    let bgMap: [number, number, number, number] = [0, 0, VW, VH];
    const src = this.bgSource;
    const bgDirty = this.bgDirty;
    this.bgDirty = false;
    if (src === "beach") {
      if (bgDirty || !this.bgPaused) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.bgW, this.bgH);
        gl.useProgram(P.beach.p);
        gl.uniform2f(P.beach.u.uRes, this.bgW, this.bgH);
        gl.uniform1f(P.beach.u.uTime, 8 + t / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, T.beach); gl.generateMipmap(gl.TEXTURE_2D);
      }
    } else {
      const isVideo = src instanceof HTMLVideoElement;
      const mw = isVideo ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : src.width;
      const mh = isVideo ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : src.height;
      const ready = isVideo ? src.readyState >= 2 : src instanceof HTMLImageElement ? src.complete && mw > 0 : mw > 0;
      if (ready && (bgDirty || isVideo || src instanceof HTMLCanvasElement)) {
        gl.bindTexture(gl.TEXTURE_2D, T.media);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          gl.generateMipmap(gl.TEXTURE_2D);
          this.mediaReady = true;
        } catch (e) {
          // fall back to the demo sea first, so an onError handler can still choose another source
          this.bgSource = "beach"; this.bgDirty = true; this.dirty = true;
          this.err("Background cannot be used as a texture (cross-origin media needs CORS + crossorigin=\"anonymous\"; files opened from disk are cross-origin too): " + (e as Error).message);
        }
      }
      if (this.mediaReady && mw && mh) {
        let box = { left: 0, top: 0, width: VW, height: VH };
        if (this.bgFit === "element" && src.isConnected) {
          const b = src.getBoundingClientRect();
          if (b.width > 2 && b.height > 2) box = b;
        }
        const s = Math.max(box.width / mw, box.height / mh), dw = mw * s, dh = mh * s;
        bgTex = T.media;
        bgMap = [box.left + (box.width - dw) / 2, box.top + (box.height - dh) / 2, dw, dh];
      }
    }

    // 2) base layer
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    const pr = this.canvas.width / VW;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bgTex);
    if (this.mode === "full") {
      gl.useProgram(P.copy.p);
      gl.uniform1i(P.copy.u.uBg, 0);
      gl.uniform4f(P.copy.u.uBgMap, ...bgMap);
      gl.uniform2f(P.copy.u.uCanvasPx, this.canvas.width, this.canvas.height);
      gl.uniform1f(P.copy.u.uPr, pr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // 3) the slab, inside a scissor box around it (shadow and caustics included)
    if (!this.visible || r.bottom < -200 || r.top > VH + 200) return;
    const az = o.sunAzimuth * Math.PI / 180, el = clamp(o.sunElevation, 5, 89) * Math.PI / 180;
    const L: [number, number, number] = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const shX = -L[0] / Math.max(L[2], 0.25) * 36 - this.tilt.ry * 1.6;
    const shY = -L[1] / Math.max(L[2], 0.25) * 36 + this.tilt.rx * 1.6;
    const W = this.slab.offsetWidth, H = this.slab.offsetHeight;
    const margin = o.thickness + 110 + Math.max(Math.abs(shX), Math.abs(shY)) + 0.12 * Math.max(W, H);
    const sx0 = clamp(r.left - margin, 0, VW), sy0 = clamp(r.top - margin, 0, VH);
    const sx1 = clamp(r.right + margin, 0, VW), sy1 = clamp(r.bottom + margin, 0, VH);
    if (sx1 <= sx0 || sy1 <= sy0) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(sx0 * pr), Math.floor((VH - sy1) * pr), Math.ceil((sx1 - sx0) * pr), Math.ceil((sy1 - sy0) * pr));

    const S = P.slab, u = S.u;
    gl.useProgram(S.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bgTex); gl.uniform1i(u.uBg, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.hf); gl.uniform1i(u.uHF, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.mat); gl.uniform1i(u.uMat, 2);
    gl.activeTexture(gl.TEXTURE0);
    const main = MAIN_TINT[o.mainColor];
    const Tk = o.thickness;
    gl.uniform2f(u.uCanvasPx, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uPr, pr);
    gl.uniform2f(u.uCenter, r.left + r.width / 2, r.top + r.height / 2);
    gl.uniform2f(u.uHalf, W / 2, H / 2);
    gl.uniform4f(u.uHFRect, ...this.reliefRect);
    gl.uniform4f(u.uBgMap, ...bgMap);
    gl.uniformMatrix3fv(u.uR, false, rotMat(this.tilt.rx, this.tilt.ry));
    gl.uniform3f(u.uLight, ...L);
    gl.uniform3f(u.uAbsorb, ...ABSORB[o.glass]);
    gl.uniform3f(u.uMainA, ...main[0]); gl.uniform3f(u.uMainB, ...main[1]); gl.uniform1f(u.uMainOn, main[2]);
    gl.uniform1f(u.uBtn2Frost, o.secondary === "frost" ? 1 : 0);
    gl.uniform2f(u.uBtnScale, this.btn[1].s, this.btn[2].s);
    gl.uniform2f(u.uShadow, shX, shY);
    gl.uniform1f(u.uT, Tk);
    gl.uniform1f(u.uRe, Math.max(0.5, Math.min(o.edgeRadius, Tk / 2 - 0.5, o.cornerRadius - 1)));
    gl.uniform1f(u.uRc, o.cornerRadius);
    gl.uniform1f(u.uCam, o.camera);
    gl.uniform1f(u.uZTop, o.buttonHeight * 1.3 + 1.5);
    gl.uniform1f(u.uZBot, Math.max(this.zBot, -(Tk - 2)));
    gl.uniform1f(u.uCutMatte, o.finish);
    gl.uniform1f(u.uFrost, o.frost);
    gl.uniform1f(u.uBgDist, 240);
    gl.uniform1f(u.uIor, o.ior);
    gl.uniform1f(u.uAA, o.antialias ? 1 : 0);
    gl.uniform1f(u.uSky, o.reflections === "sky" ? 1 : 0);
    gl.uniform1f(u.uDisp, o.dispersion * 0.05);
    gl.uniform1f(u.uCaustic, o.caustics);
    gl.uniform1f(u.uBubbles, o.bubbles);
    gl.uniform1f(u.uFill, o.fill === "gold" ? 1 : o.fill === "white" ? 2 : 0);
    gl.uniform1f(u.uOverlay, this.mode === "overlay" ? 1 : 0);
    gl.uniform1f(u.uTime, t / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }
}
