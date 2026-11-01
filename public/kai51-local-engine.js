const VERSION = "kai51-gemma3-1b-webgpu-v3";
const MODEL = "Google Gemma 3 1B Instruct";
const RUNTIME = "gemma-webgpu@0.1.0";
const MODEL_BYTES = 1069306400;

export async function createKai51Engine({onProgress=()=>{},onReady=()=>{}}={}) {
  let runtime = null;
  let loading = null;
  let lastError = null;
  let currentProgress = 0;

  const report = (progress,status) => {
    currentProgress = Math.max(currentProgress,Number(progress) || 0);
    try { onProgress({profile:"heavy",progress:currentProgress,status,file:""}); } catch {}
  };

  // The Gemma runtime downloads GGUF weights with HTTP Range requests. Its
  // progress callback only fires after each tensor/layer has been uploaded,
  // leaving the UI apparently frozen at 5% during long first transfers.
  async function createWithTransferProgress(create,options) {
    const originalFetch = globalThis.fetch;
    let transferred = 0;
    let totalBytes = 0;
    globalThis.fetch = async (input,init) => {
      const response = await originalFetch.call(globalThis,input,init);
      const url = typeof input === "string" ? input : (input?.url || "");
      if (!url.includes("huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q8_0.gguf") || !response.body) return response; //\.co\/unsloth\/gemma-3-1b-it-GGUF\/resolve\/main\/gemma-3-1b-it-Q8_0\.gguf/i.test(url) || !response.body) return response;
      const rangeTotal = Number(String(response.headers.get("content-range") || "").split("/").pop()) || 0; ///bytes\s+\d+-\d+\/(\d+)/i);
      const length = Number(response.headers.get("content-length")) || 0;
      if (rangeTotal) totalBytes = rangeTotal;
      else if (!totalBytes && length) totalBytes = length;
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const part = await reader.read();
            if (part.done) { controller.close(); return; }
            transferred += part.value?.byteLength || 0;
            const pct = Math.min(88,5 + transferred / MODEL_BYTES * 83);
            const mb = (transferred / 1048576).toFixed(1);
            const totalMb = (MODEL_BYTES / 1048576).toFixed(0);
            report(pct, "Downloading Gemma weights to this computer · " + mb + " / " + totalMb + " MB");
            controller.enqueue(part.value);
          } catch(error) { controller.error(error); }
        },
        cancel(reason) { return reader.cancel(reason); }
      });
      return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
    };
    try { return await create(options); }
    finally { globalThis.fetch = originalFetch; }
  }

  function withTimeout(promise,ms,stage) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_,reject) => { timer = setTimeout(() => reject(new Error(stage + " timed out. Check the browser connection and GPU support, then retry.")),ms); })
    ]).finally(() => clearTimeout(timer));
  }

  async function rawGenerate(prompt,options={}) {
    if (!runtime) throw new Error("Gemma runtime is not initialized.");
    runtime.resetConversation();
    runtime.addUserMessage(String(prompt || ""));
    let response = "";
    const maxTokens = Number(options.maxTokens) || 320;
    for await (const token of runtime.generate({
      temperature: options.temperature ?? 0.55,
      topP: options.topP ?? 0.9,
      repPenalty: options.repPenalty ?? 1.08,
      maxTokens,
      toolsJson: options.toolsJson || "[]",
      signal: options.signal
    })) {
      response += String(token || "");
      try { options.onToken?.(response); } catch {}
    }
    return response.trim();
  }

  async function prepare() {
    if (runtime) return {ok:true,model:MODEL,device:"webgpu",realModel:true,localModel:true};
    if (loading) return loading;
    if (!globalThis.navigator?.gpu?.requestAdapter) {
      throw new Error("This device/browser does not support WebGPU. Use a recent Chrome or Edge on a compatible laptop, or Safari 18+ on a supported iPhone. KAI will not switch to cloud inference.");
    }
    loading = (async () => {
      currentProgress = 0;
      report(2,"Preparing local Gemma WebGPU runtime");
      const adapter = await withTimeout(navigator.gpu.requestAdapter(),30000,"WebGPU adapter initialization");
      if (!adapter) throw new Error("WebGPU is present, but this device did not provide a compatible GPU adapter.");
      report(5,"Loading Gemma runtime");
      let mod;
      try {
        report(5,"Connecting to Gemma runtime CDN · primary");
        mod = await withTimeout(import("https://esm.sh/" + RUNTIME),15000,"Primary Gemma runtime CDN");
      } catch (primaryError) {
        report(6,"Primary CDN unavailable · switching Gemma runtime mirror");
        mod = await withTimeout(import("https://cdn.jsdelivr.net/npm/" + RUNTIME + "/+esm"),60000,"Gemma runtime mirror");
      }
      const create = mod.createGemmaEngine || mod.default?.createGemmaEngine;
      if (typeof create !== "function") throw new Error("The Gemma WebGPU package did not expose createGemmaEngine.");
      runtime = await withTimeout(createWithTransferProgress(create,{
        model:"1b",
        contextLength:2048,
        onProgress:p => {
          const loaded = Number(p?.loaded) || 0;
          const total = Number(p?.total) || 0;
          const pct = total > 0 ? Math.min(88, 5 + loaded / total * 83) : currentProgress;
          report(pct,p?.status || "Downloading Gemma weights to this device");
        }
      }),1200000,"Gemma model download and initialization");
      report(91,"Running Gemma local inference self-test");
      const check = await rawGenerate("Reply briefly with a short confirmation that KAI is ready.",{maxTokens:24,temperature:0,topP:1,toolsJson:"[]"});
      if (!check) throw new Error("Gemma loaded but returned an empty self-test response.");
      runtime.resetConversation();
      report(100,"Gemma 3 1B is ready on this device");
      lastError = null;
      try {
        onReady({
          model:MODEL,
          modelId:"Gemma 3 1B Instruct",
          device:"webgpu",
          verified:true,
          realModel:true,
          localModel:true,
          lane:"gemma",
          quantization:"Q8_0"
        });
      } catch {}
      return {ok:true,model:MODEL,device:"webgpu",realModel:true,localModel:true};
    })().catch(async error => {
      lastError = String(error?.message || error);
      try { await runtime?.dispose?.(); } catch {}
      runtime = null;
      report(99,"Gemma initialization failed");
      throw error;
    }).finally(() => { loading = null; });
    return loading;
  }

  async function generate(message,history=[],options={}) {
    await prepare();
    const response = await rawGenerate(message,options);
    if (!response) throw new Error("Gemma returned an empty response.");
    return {
      response,
      provider:"Google Gemma 3 1B · local WebGPU",
      model:MODEL,
      modelId:"Gemma 3 1B Instruct",
      device:"webgpu",
      local:true,
      localModel:true,
      lane:"gemma",
      quantization:"Q8_0"
    };
  }

  return {
    version:VERSION,
    model:MODEL,
    prepare,
    generate,
    chat:generate,
    isReady:()=>!!runtime,
    status:()=>({ready:!!runtime,model:MODEL,device:"webgpu",local:true,error:lastError}),
    dispose:async()=>{try{await runtime?.dispose?.();}catch{}runtime=null;}
  };
}