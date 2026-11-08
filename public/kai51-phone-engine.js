const MODEL_ID = "onnx-community/SmolLM2-135M-Instruct-ONNX-MHA";
const MODEL_NAME = "SmolLM2 135M Instruct";
const VERSION = "kai51-smollm2-135m-chat-template-v6";

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
      let adapter = null;
      try {
        if (globalThis.navigator?.gpu?.requestAdapter) {
          adapter = await Promise.race([
            navigator.gpu.requestAdapter({powerPreference:"low-power"}),
            new Promise(resolve=>setTimeout(()=>resolve(null),6000))
          ]);
        }
      } catch {}
      const supportsFp16 = !!adapter?.features?.has?.("shader-f16");
      const hasBuffer = Number(adapter?.limits?.maxBufferSize||0) >= 134217728;
      if (adapter && supportsFp16 && hasBuffer) {
        activeDevice = "webgpu";
        activeDtype = "q4f16";
      } else {
        activeDevice = "wasm";
        activeDtype = "q4";
      }
      report(2,activeDevice === "webgpu" ? "Preparing the 118 MB phone model for WebGPU" : "Preparing the compact phone model for CPU compatibility");
      const mod = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2");
      const pipeline = mod.pipeline;
      const env = mod.env;
      if (env) {
        env.useBrowserCache = true;
        env.useWasmCache = true;
        env.allowRemoteModels = true;
        env.allowLocalModels = false;
        env.cacheKey = "haxbro-smollm2-135m-onnx-mha-v2";
        if (activeDevice === "wasm" && env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = globalThis.crossOriginIsolated
            ? Math.max(1,Math.min(4,Number(navigator.hardwareConcurrency)||2))
            : 1;
        }
      }
      if (typeof pipeline !== "function") throw new Error("Transformers.js did not expose its text-generation pipeline.");
      report(5,activeDevice === "webgpu" ? "Downloading SmolLM2 135M Q4F16 weights (about 118 MB) to this phone" : "Downloading SmolLM2 135M Q4 CPU-compatible weights (about 182 MB) to this phone");
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
      const check = await generator([
        {role:"system",content:"You are KAI 51. Reply briefly and naturally."},
        {role:"user",content:"Reply with exactly the word READY."}
      ],{
        max_new_tokens:16,
        temperature:0,
        do_sample:false,
        return_full_text:false
      });
      const checkItem=check?.[0]?.generated_text;
      const checkText=String(typeof checkItem==="string"?checkItem:checkItem?.at?.(-1)?.content||"").trim();
      if (!/READY/i.test(checkText)) throw new Error("SmolLM2 loaded but failed its READY inference self-test: "+checkText.slice(0,100));
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
    const prompt=String(message||"").trim();
    const messages=[
      {role:"system",content:"You are KAI 51, the helpful conversational assistant inside HAxBRO AI. Answer greetings naturally, understand the exact request, and be concise but useful. When source evidence is included in the user's message, synthesize it carefully, cite only supplied source numbers, and never invent research. Do not output empty replies or simulated tool calls."},
      {role:"user",content:prompt}
    ];
    let timer;
    const abort=()=>{try{generator?.interrupt?.();}catch{}};
    options.signal?.addEventListener?.("abort",abort,{once:true});
    try {
      const generation=generator(messages,{
        max_new_tokens:Math.min(260,Math.max(64,Number(options.maxTokens)||180)),
        temperature:options.temperature??0.65,
        top_p:options.topP??0.9,
        do_sample:(options.temperature??0.65)>0,
        repetition_penalty:options.repPenalty??1.08,
        return_full_text:false
      });
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error("SmolLM2 135M generation exceeded 90 seconds on this phone."));},90000);});
      const result=await Promise.race([generation,timeout]);
      if(options.signal?.aborted) throw new DOMException("Response stopped by user","AbortError");
      const item=result?.[0]?.generated_text;
      const response=String(typeof item==="string"?item:item?.at?.(-1)?.content||"").trim();
      if(!response) throw new Error("SmolLM2 returned an empty response.");
      return {response,provider:MODEL_NAME+" · local "+activeDevice,model:MODEL_NAME,modelId:MODEL_ID,device:activeDevice,local:true,localModel:true,lane:"phone",quantization:activeDtype.toUpperCase()};
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort",abort);
    }
    }

  return {
    version:VERSION,model:MODEL_NAME,prepare,generate,chat:generate,
    isReady:()=>!!generator,
    status:()=>({ready:!!generator,model:MODEL_NAME,device:activeDevice,local:true,error:lastError}),
    dispose:async()=>{generator=null;}
  };
}