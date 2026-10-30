/**
 * React wrapper for GlassSlab (React 18+, Vite).
 *
 * <GlassHero background={() => document.querySelector("#bg-video")} options={{ thickness: 44 }}>
 *   <p data-glass-carve data-glass-small>Effortless Marketing · Pure Peace of Mind</p>
 *   <h1 data-glass-carve>Sit Back. Let the Waves Carry Your Marketing.</h1>
 *   <p>Body copy is printed on the front face as normal HTML.</p>
 *   <button data-glass-button="1"><span data-glass-label>Start your journey free →</span></button>
 *   <button data-glass-button="2"><span data-glass-label>Sign in</span></button>
 * </GlassHero>
 */
import { useEffect, useRef, type ReactNode } from "react";
import { GlassSlab, type BackgroundSource, type GlassStats } from "./GlassSlab";
import type { GlassOptions } from "./options";
import "./glass.css";

export interface GlassHeroProps {
  children: ReactNode;
  /** Live options; changing relief options rebuilds the carving in the worker. */
  options?: Partial<GlassOptions>;
  /** The element to refract (your background video), or a getter evaluated after mount. Defaults to the demo beach. */
  background?: BackgroundSource | (() => BackgroundSource | null | undefined);
  /** overlay (default): your background stays visible; full: the canvas draws the background too. Fixed after mount. */
  mode?: "overlay" | "full";
  className?: string;
  slabClassName?: string;
  onStats?: (s: GlassStats) => void;
  onError?: (message: string) => void;
  /** Receive the engine instance (e.g. to call renderStill or enableDeviceTilt). */
  onReady?: (engine: GlassSlab) => void;
}

export function GlassHero({ children, options, background, mode = "overlay", className, slabClassName, onStats, onError, onReady }: GlassHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const slabRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlassSlab | null>(null);
  const optionsKey = JSON.stringify(options ?? {});

  useEffect(() => {
    const bg = typeof background === "function" ? background() : background;
    const engine = new GlassSlab({
      canvas: canvasRef.current!,
      host: hostRef.current!,
      slab: slabRef.current!,
      mode,
      options,
      background: bg ?? "beach",
      createWorker: () => new Worker(new URL("./relief.worker.ts", import.meta.url), { type: "module" }),
      onStats,
      onError,
    });
    engineRef.current = engine;
    engine.start();
    onReady?.(engine);
    return () => { engine.dispose(); engineRef.current = null; };
    // the engine is created once; options are pushed below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setOptions(JSON.parse(optionsKey) as Partial<GlassOptions>);
  }, [optionsKey]);

  return (
    <>
      <canvas ref={canvasRef} className="glass-canvas" aria-hidden="true" />
      <div ref={hostRef} className={["glass-host", className].filter(Boolean).join(" ")}>
        <div ref={slabRef} className={["glass-slab", slabClassName].filter(Boolean).join(" ")}>
          {children}
        </div>
      </div>
    </>
  );
}
