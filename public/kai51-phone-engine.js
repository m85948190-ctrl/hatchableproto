const MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct";
const MODEL_NAME = "SmolLM2 135M Instruct";
const VERSION = "kai51-smollm2-135m-webgpu-v1";

export async function createKai51PhoneEngine({onProgress=()=>{},onReady=()=>{}}={}) {
  let generator = null;
  let loading = null;
  let lastError = null;
  const report = (progress,status) => {
    try { onProgress({profile:"phone",progress,status,file:""}); } catch {}
  };

  async function prepare() {
    if (generator) return {ok:true,model:MODEL_NAME,device:"webgpu",localModel:true};
    if (loading) return loading;
    if (!globalThis.navigator?.gpu?.requestAdapter) {
      throw new Error("This phone browser does not support WebGPU. Use a recent Chrome on Android or a supported recent Safari on iPhone. KAI will not send your chat to a cloud AI.");
    }
    loading = (async () => {
      report(2,"Checking phone GPU support");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("No compatible WebGPU adapter was provided by this phone.");
      report(5,"Loading the 135 MB SmolLM2 phone model");
      const mod = await import("https://esm.sh/@huggingface/transformers@3.7.2");
      const pipeline = mod.pipeline;
      const env = mod.env;
      if (env) {
        env.useBrowserCache = true;
        env.allowRemoteModels = true;
        env.allowLocalModels = false;
      }
      if (typeof pipeline !== "function") throw new Error("Transformers.js did not expose its text-generation pipeline.");
      generator = await pipeline("text-generation",MODEL_ID,{
        device:"webgpu",
        dtype:"q4f16",
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
      try { onReady({model:MODEL_NAME,modelId:MODEL_ID,device:"webgpu",verified:true,realModel:true,localModel:true,lane:"phone",quantization:"Q4F16"}); } catch {}
      return {ok:true,model:MODEL_NAME,device:"webgpu",realModel:true,localModel:true};
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
    const prompt=String(message||"");
    const result=await generator(prompt,{
      max_new_tokens:Number(options.maxTokens)||220,
      temperature:options.temperature??0.55,
      top_p:options.topP??0.9,
      do_sample:(options.temperature??0.55)>0,
      repetition_penalty:options.repPenalty??1.08,
      return_full_text:false
    });
    if(options.signal?.aborted) throw new DOMException("Response stopped by user","AbortError");
    const response=String(result?.[0]?.generated_text||"").trim();
    if(!response) throw new Error("SmolLM2 returned an empty response.");
    return {response,provider:"SmolLM2 135M · local WebGPU",model:MODEL_NAME,modelId:MODEL_ID,device:"webgpu",local:true,localModel:true,lane:"phone",quantization:"Q4F16"};
  }

  return {
    version:VERSION,model:MODEL_NAME,prepare,generate,chat:generate,
    isReady:()=>!!generator,
    status:()=>({ready:!!generator,model:MODEL_NAME,device:"webgpu",local:true,error:lastError}),
    dispose:async()=>{generator=null;}
  };
}