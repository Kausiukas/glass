/**
 * Relief builder worker. Vite: `new Worker(new URL("./relief.worker.ts", import.meta.url), { type: "module" })`.
 * Message in: { id, input: ReliefInput }. Message out: { id, out: ReliefOutput } (buffers transferred).
 */
import { computeRelief, type ReliefInput } from "./reliefCore";

// typed locally so this file compiles with the DOM lib (no separate worker tsconfig needed)
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; input: ReliefInput }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
ctx.onmessage = (e: MessageEvent<{ id: number; input: ReliefInput }>) => {
  const { id, input } = e.data;
  try {
    const out = computeRelief(input);
    ctx.postMessage({ id, out }, [out.hf.buffer, out.mat.buffer]);
  } catch (err) {
    ctx.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
