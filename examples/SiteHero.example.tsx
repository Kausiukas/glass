/**
 * Example: the Ekopolimeras Marketing hero with the glass slab (React + Vite + Tailwind v4).
 * Copy src/glass/ into your app (e.g. src/components/glass/) and adapt the import paths.
 *
 * Layering (one stacking context):
 *   <video>        z-0   your existing fixed background video (also the refraction source)
 *   .glass-canvas  z-1   the WebGL canvas (fixed, transparent outside the slab, no pointer events)
 *   .glass-host    z-2   the real HTML (text stays selectable, buttons stay buttons)
 */
import { useRef } from "react";
import { GlassHero } from "../src/glass/GlassHero";
import type { GlassSlab, GlassOptions } from "../src/glass";

// Freeze your chosen look here (copy values from the lab).
const LOOK: Partial<GlassOptions> = {
  thickness: 44,
  frost: 0.14,
  glass: "float",
  tool: "gouge",
  wallAngle: 52,
  maxDepth: 14,
  chips: 0.35,
  wobble: 0.4,
  finish: 0.45,
  buttonHeight: 12,
  buttonShape: "pillow",
  cornerRadius: 28, // must equal the slab's CSS border-radius
};

export function Hero() {
  const engine = useRef<GlassSlab | null>(null);

  return (
    <>
      <video
        id="bg-video"
        className="fixed inset-0 z-0 h-full w-full object-cover"
        src="/marketing/beach-multiscene.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        // crossOrigin="anonymous"  ← only if the video comes from another domain (that server must send CORS headers)
      />

      <main className="relative z-[2] flex min-h-svh items-center justify-center px-4 py-24">
        <GlassHero
          background={() => document.getElementById("bg-video") as HTMLVideoElement | null}
          options={LOOK}
          slabClassName="w-full max-w-[920px] px-8 py-12 sm:px-14 sm:py-16 rounded-[28px]"
          onReady={e => (engine.current = e)}
          onError={msg => console.warn("[glass]", msg)}
        >
          <p data-glass-carve data-glass-small className="mb-4 font-['Open_Sans'] text-sm font-semibold uppercase tracking-[0.18em]">
            Effortless Marketing · Pure Peace of Mind
          </p>
          <h1 data-glass-carve className="font-['Poppins'] text-[clamp(2.4rem,6vw,4.25rem)] font-extrabold leading-[1.04] tracking-tight">
            Sit Back. Let the Waves Carry Your Marketing.
          </h1>
          <p className="mt-6 max-w-[56ch] font-['Open_Sans'] text-lg text-slate-900/80">
            Campaign scheduling, autonomous SEO growth and creative video synthesis, running quietly in the background.
          </p>
          <div className="mt-9 flex flex-wrap gap-4">
            <a href="/signup" data-glass-button="1" className="rounded-2xl px-7 py-4 font-['Poppins'] font-bold">
              <span data-glass-label>Start your journey free →</span>
            </a>
            <a href="/login" data-glass-button="2" className="rounded-2xl px-7 py-4 font-['Poppins'] font-bold">
              <span data-glass-label>Sign in</span>
            </a>
          </div>
        </GlassHero>
      </main>
    </>
  );
}
