const MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct";
const MODEL_NAME = "SmolLM2 135M Instruct";
const VERSION = "kai51-smollm2-135m-webgpu-v2";

export async function createKai51PhoneEngine({onProgress=()=>{},onReady=()=>{}}={}) {
  let generator = null;
  let loading = null;
  let lastError = null;
  let activeDevice = "webgpu";
  let activeDtype = "q4f16";
  const report = (progress,status) => {
    try { onProgress({profile:"phone",progress,status,file:""}); } catch {}
  };

  async function prepare() {
    if (generator) return {ok:true,model:MODEL_NAME,device:activeDevice,localModel:true};
    if (loading) return loading;
    loading = (async () => {
      const adapter = globalThis.navigator?.gpu?.requestAdapter ? await navigator.gpu.requestAdapter() : null;
      const supportsFp16 = !!adapter?.features?.has?.("shader-f16");
      if (adapter && supportsFp16) {
        activeDevice = "webgpu";
        activeDtype = "q4f16";
      } else {
        activeDevice = "wasm";
        activeDtype = "q8";
      }
      report(2,activeDevice === "webgpu" ? "Preparing the 118 MB phone model for WebGPU" : "Preparing the compact phone model for CPU compatibility");
      const mod = await import("https://esm.sh/@huggingface/transformers@3.7.2");
      const pipeline = mod.pipeline;
      const env = mod.env;
      if (env) {
        env.useBrowserCache = true;
        env.allowRemoteModels = true;
        env.allowLocalModels = false;
        if (activeDevice === "wasm" && env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = Math.max(1,Math.min(4,Number(navigator.hardwareConcurrency)||2));
      }
      if (typeof pipeline !== "function") throw new Error("Transformers.js did not expose its text-generation pipeline.");
      report(5,activeDevice === "webgpu" ? "Downloading SmolLM2 135M Q4F16 weights (about 118 MB) to this phone" : "Downloading SmolLM2 135M Q8 CPU-compatible weights (about 137 MB) to this phone");
      generator = await pipeline("text-generation",MODEL_ID,{
        device:activeDevice,
        dtype:activeDtype,
        progress_callback:p=>{
          const loaded=Number(p?.loaded)||0;
          const total=Number(p?.total)||0;
          const pct=total>0?Math.min(88,5+loaded/total*83):5;
          report(pct,p?.status||"Downloading SmolLM2 weights to this phone");
        }
      });
      report(91,"Testing local phone-model inference");
      const check = await generator("User: Reply with the short word READY.\nAssistant:",{
        max_new_tokens:12,
        temperature:0,
        do_sample:false,
        return_full_text:false
      });
      const checkText=String(check?.[0]?.generated_text||"").trim();
      if (!checkText) throw new Error("SmolLM2 loaded but its local self-test returned an empty response.");
      report(100,"SmolLM2 135M is ready locally on this phone");
      lastError=null;
      try { onReady({model:MODEL_NAME,modelId:MODEL_ID,device:activeDevice,verified:true,realModel:true,localModel:true,lane:"phone",quantization:activeDtype.toUpperCase()}); } catch {}
      return {ok:true,model:MODEL_NAME,device:activeDevice,realModel:true,localModel:true};
    })().catch(error=>{
      lastError=String(error?.message||error);
      generator=null;
      report(99,"Phone model initialization failed");
      throw error;
    }).finally(()=>{loading=null;});
    return loading;
  }

  async function generate(message,history=[],options={}) {
    await prepare();
    if(options.signal?.aborted) throw new DOMException("Response stopped by user","AbortError");
    let prompt=String(message||"");
    const tools=String(options.toolsJson||"[]");
    if(tools!=="[]" && /search_web/.test(tools)) {
      prompt += "\n\nAVAILABLE TOOL CALL FORMATS:\nFor current facts or source discovery, call search_web exactly as: <start_function_call>search_web(query: <escape>write the search query here<escape>)<end_function_call>. For a specific public page the user asks you to read, call browse_web exactly as: <start_function_call>browse_web(url: <escape>https://public-page.example<escape>)<end_function_call>. The browser is read-only: never log in, submit forms, click purchase buttons, or change accounts. Do not invent tool results. If no tool is needed, answer normally.";
    }
    const result=await generator(prompt,{
      max_new_tokens:Math.min(220,Math.max(48,Number(options.maxTokens)||180)),
      temperature:options.temperature??0.55,
      top_p:options.topP??0.9,
      do_sample:(options.temperature??0.55)>0,
      repetition_penalty:options.repPenalty??1.08,
      return_full_text:false
    });
    if(options.signal?.aborted) throw new DOMException("Response stopped by user","AbortError");
    const response=String(result?.[0]?.generated_text||"").trim();
    if(!response) throw new Error("SmolLM2 returned an empty response.");
    return {response,provider:MODEL_NAME+" · local "+activeDevice,model:MODEL_NAME,modelId:MODEL_ID,device:activeDevice,local:true,localModel:true,lane:"phone",quantization:activeDtype.toUpperCase()};
  }

  return {
    version:VERSION,model:MODEL_NAME,prepare,generate,chat:generate,
    isReady:()=>!!generator,
    status:()=>({ready:!!generator,model:MODEL_NAME,device:activeDevice,local:true,error:lastError}),
    dispose:async()=>{generator=null;}
  };
}