const VERSION = "kai51-qwen25-coder-05b-gguf-v1";
const MODEL = "Qwen2.5-Coder-0.5B-Instruct";
const MODEL_ID = "Qwen2.5-Coder-0.5B-Instruct · Q4_K_M GGUF";
const MODEL_URL = "https://huggingface.co/featherless-ai-quants/oieieio-Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/oieieio-Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf";
const WLLAMA_BASE = "https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.7/esm/";
const MODEL_SIZE = 397808032;
const MODEL_CACHE_NAME = "haxbro-kai51-model-cache-v1";
const MODEL_CACHE_KEY = "/__haxbro_model_cache__/qwen25-coder-05b-q4km.gguf";

async function downloadOrRestoreModel(report) {
  let cache = null;
  let cacheKey = null;
  try {
    if (globalThis.caches?.open) {
      cache = await caches.open(MODEL_CACHE_NAME);
      cacheKey = new Request(new URL(MODEL_CACHE_KEY, location.origin).href);
      const saved = await cache.match(cacheKey);
      if (saved) {
        const blob = await saved.blob();
        if (blob.size === MODEL_SIZE) {
          report(88, "Restored the complete Qwen2.5-Coder model from this browser's saved cache");
          return blob;
        }
        await cache.delete(cacheKey);
      }
    }
  } catch (error) {
    report(4, "Checking browser model cache; preparing a fresh download");
  }

  report(4, "Downloading Qwen2.5-Coder 0.5B directly to the browser's persistent model cache");
  const response = await fetch(MODEL_URL, {mode:"cors",credentials:"omit",cache:"no-store"});
  if (!response.ok) throw new Error("Qwen2.5-Coder download HTTP " + response.status);
  const total = Number(response.headers.get("content-length")) || MODEL_SIZE;
  if (response.status !== 200) throw new Error("Model download returned HTTP " + response.status + " instead of a complete file");
  let cacheWrite = Promise.resolve(false);
  let modelStream = response.body;
  if (modelStream?.tee) {
    const branches = modelStream.tee();
    modelStream = branches[1];
    if (cache && cacheKey) {
      cacheWrite = cache.put(cacheKey, new Response(branches[0], {
        status:200,
        headers:{"content-type":"application/octet-stream","content-length":String(total)}
      })).then(()=>true).catch(()=>false);
    }
  }
  const chunks = [];
  let loaded = 0;
  if (modelStream?.getReader) {
    const reader = modelStream.getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      loaded += part.value.byteLength;
      report(Math.min(86, 4 + loaded / total * 82), "Downloading Qwen2.5-Coder · " + Math.round(loaded / 1048576) + " / " + Math.round(total / 1048576) + " MB");
    }
  } else {
    const blob = await response.blob();
    chunks.push(blob);
    loaded = blob.size;
  }
  const modelBlob = new Blob(chunks,{type:"application/octet-stream"});
  if (!modelBlob.size || modelBlob.size !== total) {
    throw new Error("Incomplete Qwen2.5-Coder download: received " + modelBlob.size + " of " + total + " bytes. Retry the download.");
  }
  const cached = await cacheWrite;
  if (cached) {
    report(88, "Qwen2.5-Coder download saved for reuse on this device");
  } else {
    report(88, "Model downloaded for this session; persistent browser caching was unavailable");
  }
  return modelBlob;
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
          n_ctx:2048,
          n_batch:128,
          n_threads:Math.max(1,Math.min(4,cores-1))
        });
        report(91,"Running the local Coder model self-test");
        const test = await runtime.createChatCompletion([
          {role:"system",content:"You are KAI 51. Reply briefly and clearly."},
          {role:"user",content:"Say READY."}
        ],{nPredict:12,sampling:{temp:0,top_k:1,top_p:1}});
        const text=String(test||"").replace(/<\|im_end\|>|<\|im_start\|>assistant/gi,"").trim();
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
    const messages=[
      {role:"system",content:"You are KAI 51, a helpful local AI assistant. Answer directly, naturally and accurately. Be concise for simple messages. For coding requests, give complete runnable code. Never claim an action you did not perform."},
      // Recent turns and saved context are already included in the KAI prompt.
      {role:"user",content:String(prompt||"")}
    ];
    const abort=()=>{try{runtime?.interrupt?.();}catch{}};
    options.signal?.addEventListener?.("abort",abort,{once:true});
    let timer;
    const userText=String(prompt||"").split(/\nUSER:\s*/).pop().trim();
    const isGreeting=/^(?:hi|hey|hello|yo|sup|good morning|good evening|good afternoon)(?:\s+bro)?[!. ]*$/i.test(userText);
    const isCoding=/\b(?:code|coding|program|script|function|class|debug|html|css|javascript|python|typescript|sql|api)\b/i.test(userText);
    const tokenBudget=isGreeting?24:(isCoding?160:96);
    try {
      const work=runtime.createChatCompletion(messages,{
        // This 0.5B WASM model is tuned for concise answers on CPU-only devices.
        nPredict:tokenBudget,
        sampling:{temp:options.temperature??0.35,top_k:32,top_p:options.topP??0.9,penalty_repeat:options.repPenalty??1.08},
        useCache:true,
        abortSignal:options.signal
      });
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Error(MODEL+" generation timed out after 300 seconds. The local model did not finish within the device inference limit."));},300000);});
      const result=await Promise.race([work,timeout]);
      ensureActive(options.signal);
      const response=String(result||"").replace(/<\|im_end\|>|<\|im_start\|>assistant/gi,"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
      if(!response) throw new Error(MODEL+" returned an empty response.");
      return {response,provider:MODEL+" · local WASM",model:MODEL,modelId:MODEL_ID,device:"wasm",local:true,localModel:true,lane:"qwen25-coder",quantization:"Q4_K_M"};
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