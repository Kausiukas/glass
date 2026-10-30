/**
 * Every tunable of the glass slab. All lengths are CSS pixels, angles degrees, amounts 0–1.
 */
export type GlassType = "float" | "clear" | "sea";
export type Tool = "gouge" | "vee" | "sand";
export type ButtonShape = "pillow" | "dome" | "bevel";
export type MainColor = "brand" | "cobalt" | "clear";
export type ViewMode = "pointer" | "sway" | "still";

export interface GlassOptions {
  // ── glass body ──
  /** Slab thickness (front face to back face). */
  thickness: number;
  /** Surface frost 0 = clear, 1 = heavily sandblasted face. */
  frost: number;
  /** Rounding of the slab's front/back edges. Clamped to thickness / 2. */
  edgeRadius: number;
  /** Corner radius of the slab outline (match the HTML border-radius). */
  cornerRadius: number;
  /** Absorption tint: float = green edges, clear = low-iron, sea = teal. */
  glass: GlassType;
  /** Index of refraction (1.5 = window glass). */
  ior: number;

  // ── light & realism ──
  /** "sky" reflects a sky dome and the background scene; "studio" reflects a softbox. */
  reflections: "sky" | "studio";
  /** Sun direction: azimuth (0 = from the right, 90 = from below, 180 = from the left, 270 = from above). */
  sunAzimuth: number;
  /** Sun height above the glass plane. */
  sunElevation: number;
  /** Colour splitting at bevels and cuts, 0–1 (maps to an IOR spread of 0–0.05). */
  dispersion: number;
  /** Strength of light focused through the glass onto the background, 0–1. */
  caustics: number;
  /** Density of tiny air bubbles inside the glass, 0–1 (0 = none). */
  bubbles: number;

  // ── letters ──
  /** gouge = rounded floor, vee = V-chisel with a crease, sand = flat sandblast floor. */
  tool: Tool;
  /** Wall angle from the surface. Lower = gentler. */
  wallAngle: number;
  /** Depth cap for the widest strokes. */
  maxDepth: number;
  /** Chipped rim amount 0–1. */
  chips: number;
  /** Hand wobble of edges and depth, plus faint tool marks, 0–1. */
  wobble: number;
  /** Cut finish 0 = polished (refracts), 1 = matte grey. */
  finish: number;
  /** Fill in the cut: none, gold leaf, white enamel. */
  fill: "none" | "gold" | "white";
  /** Elements marked data-glass-small: frosted print (legible) or chiselled like the headline. */
  smallLine: "print" | "cut";

  // ── buttons ──
  /** Height of the raised glass buttons. 0 = flush. */
  buttonHeight: number;
  buttonShape: ButtonShape;
  /** Width of the button's rounded / bevelled shoulder (pillow and bevel). */
  buttonEdge: number;
  /** Tint of data-glass-button="1". */
  mainColor: MainColor;
  /** Finish of data-glass-button="2". */
  secondary: "clear" | "frost";

  // ── view ──
  view: ViewMode;
  /** Resting tilt [rotateX, rotateY] in degrees. Positive X shows the bottom edge, negative Y shows the right edge. */
  restTilt: [number, number];
  /** Max tilt [x, y] when following the pointer or device. */
  maxTilt: [number, number];
  /** Perspective distance, shared by CSS and the shader camera. */
  camera: number;

  // ── rendering ──
  /** auto = adapt resolution to frame rate (max 1.5 device px per CSS px); full = fixed max 2. */
  quality: "auto" | "full";
  /** Extra rays on edges. */
  antialias: boolean;
  /** Honour prefers-reduced-motion: still view, no sway. */
  respectReducedMotion: boolean;
}

export const DEFAULTS: GlassOptions = {
  thickness: 44,
  frost: 0.14,
  edgeRadius: 10,
  cornerRadius: 28,
  glass: "float",
  ior: 1.5,

  reflections: "sky",
  sunAzimuth: 236,
  sunElevation: 41,
  dispersion: 0.35,
  caustics: 0.4,
  bubbles: 0.12,

  tool: "gouge",
  wallAngle: 52,
  maxDepth: 14,
  chips: 0.35,
  wobble: 0.4,
  finish: 0.45,
  fill: "none",
  smallLine: "print",

  buttonHeight: 12,
  buttonShape: "pillow",
  buttonEdge: 12,
  mainColor: "brand",
  secondary: "clear",

  view: "pointer",
  restTilt: [11, -16],
  maxTilt: [16, 22],
  camera: 1500,

  quality: "auto",
  antialias: true,
  respectReducedMotion: true,
};

/** Changing any of these rebuilds the relief height field (done off the main thread when a worker is supplied). */
export const RELIEF_KEYS: (keyof GlassOptions)[] = [
  "tool", "wallAngle", "maxDepth", "chips", "wobble", "smallLine", "buttonHeight", "buttonShape", "buttonEdge", "quality",
];

export const LETTER_STYLES: Record<"hand" | "crystal" | "laser", Partial<GlassOptions>> = {
  hand: { tool: "gouge", wallAngle: 52, maxDepth: 14, chips: 0.35, wobble: 0.4, finish: 0.45 },
  crystal: { tool: "vee", wallAngle: 46, maxDepth: 16, chips: 0.12, wobble: 0.08, finish: 0 },
  laser: { tool: "sand", wallAngle: 80, maxDepth: 12, chips: 0, wobble: 0, finish: 0.7 },
};

export const SLAB_PRESETS: Record<"pane" | "plate" | "block", Partial<GlassOptions>> = {
  pane: { thickness: 12, frost: 0.62, edgeRadius: 4, glass: "clear", bubbles: 0 },
  plate: { thickness: 44, frost: 0.14, edgeRadius: 10, glass: "float", bubbles: 0.12 },
  block: { thickness: 96, frost: 0, edgeRadius: 18, glass: "sea", bubbles: 0.3 },
};

/** Beer–Lambert absorption per CSS px of glass (r, g, b). */
export const ABSORB: Record<GlassType, [number, number, number]> = {
  float: [0.004, 0.001, 0.0029],
  clear: [0.0009, 0.0006, 0.0007],
  sea: [0.0062, 0.0017, 0.0013],
};

/** Tint of the main button across its width [left, right] and whether it is tinted at all. */
export const MAIN_TINT: Record<MainColor, [[number, number, number], [number, number, number], number]> = {
  brand: [[0.133, 0.341, 1.0], [0.357, 0.235, 1.0], 1],
  cobalt: [[0.1, 0.22, 0.86], [0.06, 0.15, 0.72], 1],
  clear: [[1, 1, 1], [1, 1, 1], 0],
};
