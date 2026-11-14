const VERSION = "kai51-qwen25-coder-05b-gguf-v2-thread-tuned";
const MODEL = "Qwen2.5-Coder-0.5B-Instruct";
const MODEL_ID = "Qwen2.5-Coder-0.5B-Instruct · Q4_K_M GGUF";
const MODEL_URL = "https://huggingface.co/featherless-ai-quants/oieieio-Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/oieieio-Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf";
const WLLAMA_BASE = "https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.7/esm/";
const MODEL_SIZE = 397808032;
const MODEL_CACHE_NAME = "haxbro-kai51-model-cache-v1";
const MODEL_CACHE_KEY = "/__haxbro_model_cache__/qwen25-coder-05b-q4km.gguf";

async function downloadOrRestoreModel(report) {
  const run = async () => {
    let cache = null;
    try { if (globalThis.caches?.open) cache = await caches.open(MODEL_CACHE_NAME); } catch {}
    const chunkSize = 16 * 1024 * 1024;
    const chunkCount = Math.ceil(MODEL_SIZE / chunkSize);
    const chunks = [];
    let loaded = 0;
    for (let index = 0; index < chunkCount; index++) {
      const start = index * chunkSize;
      const end = Math.min(MODEL_SIZE - 1, start + chunkSize - 1);
      const expected = end - start + 1;
      const key = new Request(new URL(MODEL_CACHE_KEY + "?part=" + index, location.origin).href);
      let part = null;
      if (cache) {
        try {
          const saved = await cache.match(key);
          if (saved) {
            const blob = await saved.blob();
            if (blob.size === expected) part = blob;
            else await cache.delete(key);
          }
        } catch {}
      }
      if (!part) {
        let lastError = null;
        for (let attempt = 1; attempt <= 3 && !part; attempt++) {
          try {
            report(Math.min(86, 4 + loaded / MODEL_SIZE * 82), "Downloading model chunk " + (index + 1) + " of " + chunkCount + " · " + Math.round(loaded / 1048576) + " MB saved");
            const response = await fetch(MODEL_URL, {mode:"cors",credentials:"omit",cache:"no-store",headers:{Range:"bytes=" + start + "-" + end}});
            if (response.status !== 206) throw new Error("Model chunk HTTP " + response.status + " (expected 206)");
            const range = response.headers.get("content-range") || "";
            if (!range.startsWith("bytes " + start + "-" + end + "/")) throw new Error("Model server returned an unexpected byte range: " + range);
            const data = await response.arrayBuffer();
            if (data.byteLength !== expected) throw new Error("Short model chunk: received " + data.byteLength + " of " + expected + " bytes");
            part = new Blob([data],{type:"application/octet-stream"});
            if (cache) {
              try { await cache.put(key, new Response(data,{status:200,headers:{"content-type":"application/octet-stream","content-length":String(expected)}})); } catch {}
            }
          } catch (error) {
            lastError = error;
            if (attempt < 3) await new Promise(resolve=>setTimeout(resolve,500*attempt));
          }
        }
        if (!part) throw new Error("Could not download model chunk " + (index + 1) + ": " + String(lastError?.message || lastError || "network error"));
      }
      chunks.push(part);
      loaded += expected;
      report(Math.min(88, 4 + loaded / MODEL_SIZE * 84), "Qwen2.5-Coder download · " + Math.round(loaded / 1048576) + " / " + Math.round(MODEL_SIZE / 1048576) + " MB");
    }
    if (loaded !== MODEL_SIZE) throw new Error("Incomplete Qwen2.5-Coder model: " + loaded + " of " + MODEL_SIZE + " bytes");
    report(88, "All model chunks are saved; assembling the local Q4_K_M model");
    return new Blob(chunks,{type:"application/octet-stream"});
  };
  if (globalThis.navigator?.locks?.request) return navigator.locks.request("haxbro-kai51-qwen25-coder-model-download-v1",{mode:"exclusive"},run);
  return run();
}

export async function createKai51Engine({onProgress=()=>{},onReady=()=>{}}={}) {
  let runtime = null;
  let loading = null;
  let lastError = null;
  let readyInfo = null;
  const report = (progress,status) => {
    try { onProgress({profile:"local",progress:Math.max(0,Math.min(100,Number(progress)||0)),status:String(status||"Preparing the shared local Coder model"),file:""}); } catch {}
  };
  const ensureActive = signal => {
    if(signal?.aborted) throw new DOMException("Response stopped by user","AbortError");
  };
  // Chat prompts are passed as role/content messages to Wllama.
  async function prepare() {
    if(runtime && readyInfo) return readyInfo;
    if(loading) return loading;
    loading = (async()=>{
      try {
        try { await globalThis.navigator?.storage?.persist?.(); } catch {}
        report(1,"Loading the shared Qwen2.5-Coder runtime");
        const {Wllama} = await import(WLLAMA_BASE+"index.js");
        if(typeof Wllama!=="function") throw new Error("The browser-local llama.cpp runtime did not load.");
        const wasmPaths={
          "single-thread/wllama.wasm":"https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.7/src/single-thread/wllama.wasm",
          "multi-thread/wllama.wasm":"https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.7/src/multi-thread/wllama.wasm"
        };
        runtime = new Wllama(wasmPaths,{parallelDownloads:2,allowOffline:true});
        report(3,"Checking this device's saved Qwen2.5-Coder model cache");
        const cores=Math.max(1,Number(globalThis.navigator?.hardwareConcurrency)||4);
        const modelBlob=await downloadOrRestoreModel(report);
        report(89,"Loading the downloaded Q4_K_M weights into the local WASM engine");
        await runtime.loadModel([modelBlob],{
          n_ctx:1536,
          n_batch:256,
          n_threads:Math.max(1,Math.min(6,cores-1))
        });
        report(91,"Running the local Coder model self-test");
        const test = await runtime.createChatCompletion([
          {role:"system",content:"You are KAI 51. Reply briefly and clearly."},
          {role:"user",content:"Say READY."}
        ],{
          nPredict:12,
          sampling:{temp:0,top_k:1,top_p:1}
        });
        const text=String(test||"").trim();
        // This is an inference smoke test, not an exact-phrase grading test.
        // Different valid Qwen tokenizations/template outputs must not block an installed model.
        if(!text) throw new Error("The downloaded Coder model loaded but returned an empty self-test response.");
        readyInfo={ok:true,model:MODEL,modelId:MODEL_ID,device:"wasm",verified:true,realModel:true,localModel:true,lane:"qwen25-coder",quantization:"Q4_K_M",selfTest:text};
        lastError=null;
        report(100,"Qwen2.5-Coder 0.5B is ready locally on this device");
        try { onReady(readyInfo); } catch {}
        return readyInfo;
      } catch(error) {
        lastError=String(error?.message||error).slice(0,700);
        try { await runtime?.exit?.(); } catch {}
        runtime=null; readyInfo=null;
        report(0,"Qwen2.5-Coder initialization failed: "+lastError.slice(0,150));
        throw new Error(lastError);
      } finally { loading=null; }
    })();
    return loading;
  }

  async function generate(prompt,history=[],options={}) {
    ensureActive(options.signal);
    await prepare();
    ensureActive(options.signal);
    // Prototype-compatible inference: send one complete prompt straight to
    // the downloaded GGUF model. KAI context and conversation history are
    // already composed by the caller, so do not wrap or rewrite them again.
    const directPrompt=String(prompt||"").trim();
    if(!directPrompt) throw new Error(MODEL+" received an empty prompt.");
    const abort=()=>{try{runtime?.interrupt?.();}catch{}};
    options.signal?.addEventListener?.("abort",abort,{once:true});
    let timer;
    const userText=directPrompt.split(/\nUSER:\s*/i).pop().trim();
    const isGreeting=/^(?:hi|hey|hello|yo|sup|good morning|good evening|good afternoon)(?:\s+bro)?[!. ]*$/i.test(userText);
    const isCoding=/\b(?:code|coding|program|script|function|class|debug|html|css|javascript|python|typescript|sql|api)\b/i.test(userText);
    // Respect the caller's task-specific budget. Research/coding callers need
    // enough room to explain evidence; the ordinary chat path remains compact.
    const requestedBudget=Number(options.maxTokens);
    const tokenBudget=Number.isFinite(requestedBudget)&&requestedBudget>0
      ? Math.min(384,Math.max(16,Math.floor(requestedBudget)))
      : (isGreeting?24:(isCoding?160:96));
    try {
      const work=runtime.createChatCompletion([
        {role:"system",content:"You are KAI 51, a capable conversational assistant. Answer the exact question, use the recent conversation context supplied in the user prompt, and explain your reasoning in plain language. For comparisons, evaluate clear criteria before giving a balanced verdict. If challenged with how you know, state the evidence or admit when a previous answer was unsupported; never double down or invent sources. Never refuse ordinary harmless questions. Never claim an action you did not perform."},
        {role:"user",content:directPrompt}
      ],{
        nPredict:tokenBudget,
        sampling:{temp:options.temperature??0.35,top_k:32,top_p:options.topP??0.9,penalty_repeat:options.repPenalty??1.08},
        useCache:true
      });
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error(MODEL+" generation timed out after 60 seconds. The local model did not finish within the device inference limit."));},60000);});
      const result=await Promise.race([work,timeout]);
      ensureActive(options.signal);
      const raw=typeof result==="string"?result:(result?.response??result?.text??result?.content??result?.message??"");
      const response=String(raw||"").replace(/<\|im_end\|>|<\|im_start\|>assistant/gi,"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
      if(!response) throw new Error(MODEL+" returned an empty response from local inference.");
      return {response,provider:MODEL+" · local Wllama inference",model:MODEL,modelId:MODEL_ID,device:"wasm",local:true,localModel:true,lane:"qwen25-coder",quantization:"Q4_K_M"};
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.("abort",abort);
    }
  }

  return {
    version:VERSION,get model(){return MODEL;},modelId:MODEL_ID,prepare,generate,chat:generate,
    isReady:()=>!!runtime&&!!readyInfo,
    status:()=>({ready:!!runtime&&!!readyInfo,model:MODEL,modelId:MODEL_ID,device:"wasm",local:true,quantization:"Q4_K_M",error:lastError}),
    dispose:async()=>{try{await runtime?.exit?.();}catch{}runtime=null;readyInfo=null;}
  };
}