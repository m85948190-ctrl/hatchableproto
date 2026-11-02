const VERSION = "kai51-qwen25-coder-7b-webgpu-v1";
const MODEL = "Qwen2.5-Coder-7B-Instruct";
const MODEL_ID = "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC";
const MODEL_URL = "https://huggingface.co/mlc-ai/Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC";
const MODEL_LIB = "/web-llm-models/Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm";
const VRAM_REQUIRED_MB = 5106.67;

export async function createKai51Engine({onProgress=()=>{},onReady=()=>{}}={}) {
  let runtime = null;
  let loading = null;
  let lastError = null;
  let currentProgress = 0;

  const report = (progress,status) => {
    currentProgress = Math.max(currentProgress,Math.min(99,Number(progress)||0));
    try { onProgress({profile:"heavy",progress:currentProgress,status:String(status||"Preparing Qwen local runtime"),file:""}); } catch {}
  };

  function ensureActive(signal) {
    if (signal?.aborted) throw new DOMException("Response stopped by user","AbortError");
  }

  async function prepare() {
    if (runtime) return {ok:true,model:MODEL,modelId:MODEL_ID,device:"webgpu",realModel:true,localModel:true};
    if (loading) return loading;
    if (!globalThis.navigator?.gpu?.requestAdapter) {
      throw new Error("Qwen2.5-Coder-7B needs browser WebGPU. Use a recent supported desktop Chrome or Edge with a compatible GPU. Phones continue to use the compact local KAI model.");
    }
    loading = (async () => {
      currentProgress = 0;
      report(2,"Checking GPU support for Qwen2.5-Coder-7B");
      const adapter = await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
      if (!adapter) throw new Error("WebGPU is available, but this device did not provide a compatible high-performance GPU adapter.");
      const maxBuffer = Number(adapter.limits?.maxBufferSize)||0;
      if (maxBuffer && maxBuffer < 268435456) {
        throw new Error("This GPU's maximum buffer size is too small for Qwen2.5-Coder-7B. A desktop GPU with a larger WebGPU buffer limit is required.");
      }
      report(4,"Loading the HAxBRO-hosted WebLLM runtime");
      const webllm = await import("/vendor/web-llm-runtime.js");
      if (typeof webllm.CreateMLCEngine !== "function") throw new Error("The local WebLLM runtime did not expose CreateMLCEngine.");
      const modelRecord = {
        model:MODEL_URL,
        model_id:MODEL_ID,
        model_lib:new URL(MODEL_LIB,globalThis.location.origin).href,
        low_resource_required:false,
        vram_required_MB:VRAM_REQUIRED_MB,
        overrides:{context_window_size:4096}
      };
      runtime = await webllm.CreateMLCEngine(MODEL_ID,{
        appConfig:{model_list:[modelRecord],cacheBackend:"cache"},
        logLevel:"WARN",
        initProgressCallback:progress=>{
          const fraction=Math.max(0,Math.min(1,Number(progress?.progress)||0));
          report(5+fraction*84,progress?.text||"Downloading and initializing Qwen2.5-Coder-7B locally");
        }
      });
      report(92,"Running Qwen local inference self-test");
      const check = await runtime.chat.completions.create({
        messages:[
          {role:"system",content:"You are KAI 51, the assistant inside HAxBRO AI. Answer briefly and naturally."},
          {role:"user",content:"Reply with exactly: KAI READY"}
        ],
        temperature:0,
        max_tokens:16,
        stream:false
      });
      const checkText=String(check?.choices?.[0]?.message?.content||"").trim();
      if (!checkText) throw new Error("Qwen loaded, but its local self-test returned an empty answer.");
      report(100,"Qwen2.5-Coder-7B is ready locally on this computer");
      lastError=null;
      try { onReady({model:MODEL,modelId:MODEL_ID,device:"webgpu",verified:true,realModel:true,localModel:true,lane:"qwen",quantization:"Q4F16_1",vramRequiredMB:VRAM_REQUIRED_MB,selfTest:checkText}); } catch {}
      return {ok:true,model:MODEL,modelId:MODEL_ID,device:"webgpu",realModel:true,localModel:true,selfTest:checkText};
    })().catch(async error=>{
      lastError=String(error?.message||error);
      try { await runtime?.unload?.(); } catch {}
      runtime=null;
      report(99,"Qwen2.5-Coder-7B initialization failed");
      throw error;
    }).finally(()=>{loading=null;});
    return loading;
  }

  async function generate(prompt,history=[],options={}) {
    ensureActive(options.signal);
    await prepare();
    ensureActive(options.signal);
    let response="";
    const abort=()=>{try{runtime?.interruptGenerate?.();}catch{}};
    options.signal?.addEventListener?.("abort",abort,{once:true});
    try {
      const stream=await runtime.chat.completions.create({
        messages:[{role:"user",content:String(prompt||"")}],
        stream:true,
        temperature:options.temperature??0.45,
        top_p:options.topP??0.9,
        repetition_penalty:options.repPenalty??1.08,
        max_tokens:Number(options.maxTokens)||512
      });
      for await (const chunk of stream) {
        ensureActive(options.signal);
        response+=String(chunk?.choices?.[0]?.delta?.content||"");
        try { options.onToken?.(response); } catch {}
      }
    } finally {
      options.signal?.removeEventListener?.("abort",abort);
    }
    response=response.trim();
    if (!response) throw new Error("Qwen2.5-Coder-7B returned an empty response.");
    return {
      response,
      provider:"Qwen2.5-Coder-7B-Instruct · local WebGPU",
      model:MODEL,
      modelId:MODEL_ID,
      device:"webgpu",
      local:true,
      localModel:true,
      lane:"qwen",
      quantization:"Q4F16_1",
      vramRequiredMB:VRAM_REQUIRED_MB
    };
  }

  return {
    version:VERSION,
    model:MODEL,
    modelId:MODEL_ID,
    prepare,
    generate,
    chat:generate,
    isReady:()=>!!runtime,
    status:()=>({ready:!!runtime,model:MODEL,modelId:MODEL_ID,device:"webgpu",local:true,error:lastError,vramRequiredMB:VRAM_REQUIRED_MB}),
    dispose:async()=>{try{await runtime?.unload?.();}catch{}runtime=null;}
  };
}