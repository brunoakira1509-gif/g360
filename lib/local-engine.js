// Motor de IA local (WebLLM/WebGPU) compartilhado: carrega o modelo uma vez só,
// mesmo quando o chat e a seleção de colunas usam ao mesmo tempo.
export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Leve (1,5B): mais rápido, download menor' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Equilibrado (3B): mais preciso, download maior' },
];

let state = { id: null, engine: null, worker: null, promise: null };

export const hasWebGpu = () => typeof navigator !== 'undefined' && !!navigator.gpu;
export const peekEngine = id => (state.engine && state.id === id ? state.engine : null);

export async function ensureEngine(modelId, onProgress) {
  if (peekEngine(modelId)) return state.engine;
  if (state.promise && state.id === modelId) return state.promise;
  await releaseEngine();
  state.id = modelId;
  state.promise = (async () => {
    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
    const worker = new Worker(new URL('./local-llm.worker.js', import.meta.url), { type: 'module' });
    try {
      const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: p => onProgress?.(p.text || 'Preparando o modelo local...'),
      });
      state.engine = engine; state.worker = worker;
      return engine;
    } catch (error) {
      worker.terminate();
      state = { id: null, engine: null, worker: null, promise: null };
      throw error;
    }
  })();
  return state.promise;
}

export async function releaseEngine() {
  const { engine, worker } = state;
  state = { id: null, engine: null, worker: null, promise: null };
  try { await engine?.unload(); } catch (e) { console.error('Local AI cleanup failed:', e); }
  worker?.terminate?.();
}
