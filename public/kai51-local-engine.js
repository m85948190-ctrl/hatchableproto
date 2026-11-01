const VERSION = "kai51-gemma3-1b-webgpu-v1";
const MODEL = "Google Gemma 3 1B Instruct";
const RUNTIME = "gemma-webgpu@0.1.0";

export async function createKai51Engine({onProgress=()=>{},onReady=()=>{}}={}) {
  let runtime = null;
  let loading = null;
  let lastError = null;

  const report = (progress,status) => {
    try { onProgress({profile:"heavy",progress,status,file:""}); } catch {}
  };

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
      report(2,"Preparing local Gemma WebGPU runtime");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("WebGPU is present, but this device did not provide a compatible GPU adapter.");
      report(5,"Loading Gemma runtime");
      const mod = await import("https://esm.sh/" + RUNTIME);
      const create = mod.createGemmaEngine || mod.default?.createGemmaEngine;
      if (typeof create !== "function") throw new Error("The Gemma WebGPU package did not expose createGemmaEngine.");
      runtime = await create({
        model:"1b",
        contextLength:2048,
        onProgress:p => {
          const loaded = Number(p?.loaded) || 0;
          const total = Number(p?.total) || 0;
          const pct = total > 0 ? Math.min(88, 5 + loaded / total * 83) : 5;
          report(pct,p?.status || "Downloading Gemma weights to this device");
        }
      });
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