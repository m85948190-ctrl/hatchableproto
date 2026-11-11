const VERSION = "kai51-qwen25-coder-05b-gguf-v1";
const MODEL = "Qwen2.5-Coder-0.5B-Instruct";
const MODEL_ID = "Qwen2.5-Coder-0.5B-Instruct · Q4_K_M GGUF";
const MODEL_URL = "https://huggingface.co/featherless-ai-quants/oieieio-Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/oieieio-Qwen2.5-Coder-0.5B-Instruct-Q4_K_M.gguf";
const WLLAMA_BASE = "https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.7/esm/";

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
        await runtime.loadModelFromUrl(MODEL_URL,{
          n_ctx:2048,
          n_batch:128,
          n_threads:Math.max(1,Math.min(4,cores-1)),
          useCache:true,
          progressCallback:p=>{
            const loaded=Number(p?.loaded)||0;
            const total=Number(p?.total)||0;
            const pct=total>0?Math.min(88,4+loaded/total*84):4;
            report(pct,p?.status||"Restoring or downloading the shared Q4_K_M model");
          }
        });
        report(91,"Running the local Coder model self-test");
        const test = await runtime.createChatCompletion([
          {role:"system",content:"You are KAI 51. Follow the user's instruction exactly."},
          {role:"user",content:"Reply with exactly: KAI READY"}
        ],{nPredict:20,sampling:{temp:0,top_k:1,top_p:1}});
        const text=String(test||"").replace(/<\|im_end\|>|<\|im_start\|>assistant/gi,"").trim();
        if(!text || !/KAI\s*READY/i.test(text)) throw new Error("The downloaded Coder model did not pass its inference self-test: "+text.slice(0,100));
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
    try {
      const work=runtime.createChatCompletion(messages,{
        // This 0.5B WASM model is tuned for concise answers on CPU-only devices.
        nPredict:(/^(?:hi|hey|hello|yo|sup|good morning|good evening|good afternoon)[!. ]*$/i.test(String(prompt||"").trim())?24:(/\b(?:code|coding|program|script|function|class|debug|html|css|javascript|python|typescript|sql|api)\b/i.test(String(prompt||""))?160:96)),
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