// Motor de IA local (WebLLM/WebGPU) compartilhado: carrega o modelo uma vez só,
// mesmo quando o chat e a seleção de colunas usam ao mesmo tempo.
export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Leve (1,5B): mais rápido, download menor' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Equilibrado (3B): mais preciso, download maior' },
];

let state = { id: null, token: null, engine: null, worker: null, promise: null };

export const hasWebGpu = () => typeof navigator !== 'undefined' && !!navigator.gpu;
export async function checkWebGpu() {
  if (!hasWebGpu()) return false;
  try { return !!(await navigator.gpu.requestAdapter()); } catch { return false; }
}
export const peekEngine = id => (state.engine && state.id === id ? state.engine : null);

export async function ensureEngine(modelId, onProgress) {
  if (peekEngine(modelId)) return state.engine;
  if (state.promise && state.id === modelId) return state.promise;
  const previous = state;
  const token = {};
  state = { id: modelId, token, engine: null, worker: null, promise: null };
  const promise = (async () => {
    let worker;
    try {
      try { await previous.engine?.unload(); } catch (error) { console.error('Previous local AI cleanup failed:', error); }
      previous.worker?.terminate?.();
      if (state.token !== token) throw new Error('O carregamento do modelo foi cancelado.');
      if (!(await checkWebGpu())) throw new Error('Este dispositivo não encontrou um adaptador WebGPU disponível.');
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
      if (state.token !== token) throw new Error('O carregamento do modelo foi cancelado.');
      worker = new Worker(new URL('./local-llm.worker.js', import.meta.url), { type: 'module' });
      state.worker = worker;
      const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: p => onProgress?.(p.text || 'Preparando o modelo local...'),
      });
      if (state.token !== token) {
        await engine.unload();
        worker.terminate();
        throw new Error('O carregamento do modelo foi cancelado.');
      }
      state.engine = engine; state.worker = worker;
      return engine;
    } catch (error) {
      worker?.terminate();
      if (state.token === token) state = { id: null, token: null, engine: null, worker: null, promise: null };
      throw error;
    }
  })();
  state.promise = promise;
  return promise;
}

export async function releaseEngine() {
  const { engine, worker } = state;
  state = { id: null, token: null, engine: null, worker: null, promise: null };
  try { await engine?.unload(); } catch (e) { console.error('Local AI cleanup failed:', e); }
  worker?.terminate?.();
}
