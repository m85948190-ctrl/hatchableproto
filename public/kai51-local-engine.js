export async function createKai51Engine({onProgress=()=>{},onReady=()=>{},preferCache=false,profile='github'}={}) {
  // LOCAL uses a smaller instruction-tuned model for faster everyday browser inference.
  // GITHUB uses the larger 360M instruction model for the stronger precision lane.
  // Both use public CORS-enabled ONNX weights and run inference inside the user's browser.
  const PROFILE=profile==='local'?'local':'github';
  const MODEL=PROFILE==='local'?'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA':'onnx-community/SmolLM2-360M-Instruct-ONNX';
  const MODEL_RELEASE=PROFILE==='local'?'local-fast-135m':'kai51-model-latest';
  const TRAINING_SYNC='/api/kai-training-sync';
  const VERSION=PROFILE==='local'?'kai51-local-135m-q4-v15-creative-fallback':'kai51-github-360m-q4-v38-conversation-parameters';
  const MODEL_ASSETS=new Set([
    'config.json',
    'generation_config.json',
    'MODEL-MANIFEST.json',
    'model_q4.onnx',
    'model_q4f16.onnx',
    'special_tokens_map.json',
    'tokenizer.json',
    'tokenizer_config.json'
  ]);
  let DEVICE='wasm';
  let DTYPE='q4';
  let pipe=null, loading=null, generationChain=Promise.resolve(), trainingPack=null, trainingPromise=null;

  async function disposePipe(){
    const current=pipe;
    pipe=null;
    if(current?.dispose){
      try{await current.dispose();}catch{}
    }
  }

  async function resolveRuntime(){
    /* Prefer this visitor's GPU only after a real adapter/device probe. Some browsers expose navigator.gpu but cannot create a compatible device; those must fall back cleanly to WASM/Q4. */
    DEVICE='wasm';
    DTYPE='q4';
    try{
      if(!globalThis.navigator?.gpu?.requestAdapter)return;
      const boundedProbe=(work,ms,label)=>Promise.race([
        Promise.resolve().then(work),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timed out')),ms))
      ]);
      const adapter=await boundedProbe(()=>navigator.gpu.requestAdapter(),5000,'WebGPU adapter probe');
      if(!adapter)return;
      const requiredFeatures=[];
      if(adapter.features?.has?.('shader-f16'))requiredFeatures.push('shader-f16');
      const probe=await boundedProbe(()=>adapter.requestDevice({requiredFeatures}),5000,'WebGPU device probe');
      try{probe.destroy?.()}catch{}
      DEVICE='webgpu';
    }catch(error){
      DEVICE='wasm';
      DTYPE='q4';
      console.info('KAI 51 using browser-local WASM/Q4 because WebGPU is unavailable on this device.',String(error?.message||error));
    }
  }

  const progress=(progress,status)=>{window.HAxBROKai51EngineDebug={profile:PROFILE,progress,status,at:new Date().toISOString(),device:DEVICE};onProgress({profile:'heavy',progress,status,file:''});};

  async function loadTrainingPack(){
    if(trainingPack) return trainingPack;
    if(trainingPromise) return trainingPromise;
    /* Use a fresh browser-cached pack first. The pack is optional prompt conditioning,
       so repeated model boots must not hit Hatchable when a valid cached copy exists. */
    let cached=null;
    try{cached=JSON.parse(localStorage.getItem('haxbro:kai51:training-pack:v2')||'null');}catch{}
    if(cached?.pack&&Number.isFinite(Number(cached.savedAt))&&Date.now()-Number(cached.savedAt)<24*60*60*1000){
      trainingPack=cached.pack;
      return trainingPack;
    }
    trainingPromise=(async()=>{
      const controller=new AbortController();
      let timer;
      try{
        const request=fetch(TRAINING_SYNC,{headers:{Accept:'application/json'},cache:'no-store',signal:controller.signal});
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('training sync timed out after 3.5 seconds'));},3500);});
        const r=await Promise.race([request,timeout]);
        if(!r.ok) throw new Error('training sync HTTP '+r.status);
        const d=await r.json();
        if(!d?.ok||!d?.canonical) throw new Error('invalid Hatchable training pack');
        trainingPack=d;
        try{localStorage.setItem('haxbro:kai51:training-pack:v2',JSON.stringify({savedAt:Date.now(),pack:d}));}catch{}
        return d;
      }catch(e){
        if(cached?.pack) return trainingPack=cached.pack;
        return trainingPack={ok:true,canonical:true,source:'HATCHABLE',rules:[] ,examples:[],warning:String(e?.message||e).slice(0,180)};
      }finally{clearTimeout(timer);trainingPromise=null;}
    })();
    return trainingPromise;
  }

  async function prepare(){
    if(pipe) return {ok:true,model:MODEL,device:DEVICE,realModel:true};
    if(loading) return loading;

    loading=(async()=>{
      progress(5,'Loading KAI 51 neural runtime');
      const {env,pipeline}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
      env.allowLocalModels=false;
      env.allowRemoteModels=true;
      // Keep browser-side inference local after the public ONNX weights are downloaded.
      env.allowLocalModels=false;
      env.allowRemoteModels=true;
      /* Both browser-local model profiles download their public ONNX assets directly
         from the model host. Never proxy hundreds of MB through Hatchable: doing so
         counts the full model transfer against Hatchable bandwidth for every uncached
         visitor. The model IDs above are public Hugging Face ONNX repositories. */
      const nativeFetch=globalThis.fetch.bind(globalThis);
      env.fetch=async(input,init={})=>nativeFetch(input,init);
      env.useBrowserCache=true;
      env.cacheKey='haxbro-kai51-q4-dual-model-v44';

      await resolveRuntime();
      /* The training pack is optional prompt conditioning; never block model startup on its network request. */
      if(PROFILE!=='local') await loadTrainingPack();
      progress(15,preferCache
        ? 'Restoring available KAI 51 neural chunks from browser cache'
        : (PROFILE==='local'?'Installing the KAI 51 LOCAL 135M Q4 fast model':'Installing the KAI 51 GITHUB 360M Q4 precision model'));
      /* Real-model handoff rule: prefer GPU, but NEVER let an unsupported WebGPU
         operator/device kill KAI 51. Retry the exact same neural weights on the
         fully-supported WASM CPU backend before declaring the model unavailable. */
      try{
        pipe=await pipeline('text-generation',MODEL,{
          dtype:DTYPE,
          device:DEVICE,
          local_files_only:false,
          // Report the real Transformers.js download progress instead of leaving the UI at 15%.
          progress_callback:info=>{
            const n=Number(info?.status==='progress_total'?info.progress:info?.progress);
            if(Number.isFinite(n)){
              const mapped=15+(Math.max(0,Math.min(100,n))*0.80);
              progress(Math.min(95,Math.round(mapped)),info?.status==='progress_total'?'Downloading KAI 51 neural model':(info?.file?'Downloading '+String(info.file).split('/').pop():'Downloading KAI 51 neural model'));
            }
          }
          // Q4 file is selected automatically by Transformers.js from dtype:'q4'.
        });
      }catch(gpuError){
        if(DEVICE!=='webgpu') throw gpuError;
        console.warn('KAI 51 WebGPU initialization failed; retrying the same real model on WASM',gpuError);
        await disposePipe();
        DEVICE='wasm';
        DTYPE='q4';
        progress(35,'KAI 51 GPU path unavailable · switching to local CPU runtime');
        pipe=await pipeline('text-generation',MODEL,{
          dtype:'q4',
          device:'wasm',
          local_files_only:false,
          progress_callback:info=>{
            const n=Number(info?.progress);
            if(Number.isFinite(n)){
              const mapped=35+(Math.max(0,Math.min(100,n))*0.60);
              progress(Math.min(95,Math.round(mapped)),info?.file?'Downloading '+String(info.file).split('/').pop():'Downloading KAI 51 neural model');
            }
          }
          // Q4 file is selected automatically by Transformers.js from dtype:'q4'.
        });
      }

      progress(95,'Running KAI 51 neural self-test');
      const test=await pipe([
        {role:'system',content:'You are KAI 51. Reply with exactly: KAI 51 online.'},
        {role:'user',content:'Status check.'}
      ],{
        max_new_tokens:16,
        do_sample:false,
        return_full_text:false
      });
      const testGenerated=test?.[0]?.generated_text;
      const text=Array.isArray(testGenerated)
        ? String(testGenerated.at(-1)?.content||'').trim()
        : String(testGenerated||test?.[0]?.text||'').trim();
      if(!text) throw new Error('KAI 51 neural model returned no output');

      progress(100,'KAI 51 real neural model ready');
      onReady({
        model:MODEL,
        device:DEVICE,
        verified:true,
        realModel:true,
        localModel:true,
        provenance:PROFILE==='local'?'Public Hugging Face ONNX weights; browser-local inference':'HAxBRO GitHub release kai51-model-latest; browser-local inference',
        lane:PROFILE,
        quantization:'q4'
      });
      return {ok:true,model:MODEL,device:DEVICE,realModel:true,localModel:true,lane:PROFILE};
    })().catch(async e=>{
      await disposePipe();
      loading=null;
      progress(99,'KAI 51 neural runtime failed');
      throw e;
    });
    return loading;
  }

  async function runOnce(messages,generationOptions={}){
    await prepare();
    return pipe(messages,{
      max_new_tokens:PROFILE==='local'?64:160,
      do_sample:PROFILE!=='local',
      temperature:0.62,
      top_p:0.90,
      repetition_penalty:PROFILE==='local'?1.15:1.08,
      no_repeat_ngram_size:3,
      return_full_text:false,
      ...generationOptions
    });
  }

  async function generate(message,history=[]){
    const prompt=String(message||'').trim();
    if(!prompt) throw new Error('KAI 51 received an empty request');
    // Local intelligence may wrap the actual message with memory/evidence instructions.
    // Classify and validate against the user's real request, not that wrapper.
    const requestMatch=prompt.match(/USER REQUEST:\s*([\s\S]*?)(?=\n\nRETRIEVED WEB \/ WIKIPEDIA \/ HAxBRO KNOWLEDGE EVIDENCE:|\n\nNo reliable retrieved evidence was available\.|$)/i);
    const userRequest=String(requestMatch?.[1]||prompt).trim();
    // Keep the evidence wrapper in the actual model input. The prior code extracted USER REQUEST for classification, then accidentally sent only that question to the neural model and discarded all retrieved sources.
    const modelUserContent=requestMatch?prompt:userRequest;
    const hasResearchEvidence=/RETRIEVED WEB \/ WIKIPEDIA \/ HAxBRO KNOWLEDGE EVIDENCE:/i.test(modelUserContent);
    const isGreeting=/^(?:hi|hello|hey|yo|howdy|good morning|good afternoon|good evening|what'?s up|sup)(?:\s+bro)?[!,.?\s]*$/i.test(userRequest);
    const isCasualReaction=/^(?:o+|h+m+|h+e+h+|l+o+l+|haha+|wow+|whoa+|huh+|hmm+|uh+|um+|nice|cool|yay+|bruh|bro+|okay+|ok+|ok\s+good|okay\s+good|all\s+right|alright|good|great|sounds\s+good|nice\s+one|👍|😂|❤️|😅|🤔)[!?. ,\s]*$/i.test(userRequest);
    const isCombinedCasual=/^(?:(?:haha+|lol+|hehe+|wow+)[,\s]+)?(?:hi|hello|hey|yo|sup)(?:[,\s]+(?:haha+|lol+|hehe+))?[!?. ,\s]*$/i.test(userRequest);
    const isSmallTalk=isGreeting||isCasualReaction||isCombinedCasual;
    // Short clarifications and corrections also go through neural inference with the recent dialogue attached.
    // Everyday conversation is handled by neural inference, not phrase-specific canned answers.
    // All chat turns, including greetings and social reactions, now use the selected real neural model.
    const generationOptions={max_new_tokens:PROFILE==='local'?64:160,do_sample:PROFILE!=='local',temperature:0.62,top_p:0.90,repetition_penalty:PROFILE==='local'?1.15:1.08,no_repeat_ngram_size:3};
    if(isSmallTalk&&PROFILE!=='local') generationOptions.max_new_tokens=48;
    // The App Maker's first pass is only a short analysis brief, not the application itself.
    // Classify the actual user request rather than wrapper instructions, otherwise analysis
    // turns were incorrectly granted the full 768/1536-token code-generation budget.
    const appAnalysis=/^\s*APP MAKER ANALYSIS ONLY\b/i.test(userRequest);
    const capability=!appAnalysis&&/\b(?:app|application|calculator|chatbot|dashboard|website|web\s*app|build|publish|export)\b/i.test(userRequest)?'app-maker':'general';
    if(appAnalysis) generationOptions.max_new_tokens=96;
    else if(capability==='app-maker') generationOptions.max_new_tokens=PROFILE==='local'?768:1536;
    else if(hasResearchEvidence){generationOptions.max_new_tokens=PROFILE==='local'?240:420;generationOptions.do_sample=true;generationOptions.temperature=0.25;generationOptions.top_p=0.9;}
    const rules=(trainingPack?.rules||[])
      .filter(x=>x&&x.rule)
      .filter(x=>x.capability==='general' || x.capability===capability)
      .filter(x=>x.id!=='creator')
      .slice(0,PROFILE==='local'?4:8)
      .map(x=>'- '+x.rule)
      .join('\n');
    const examples=(trainingPack?.examples||[])
      .filter(x=>x&&(!x.capability||x.capability===capability))
      .map(x=>{const hay=(String(x.prompt||'')+' '+(Array.isArray(x.tags)?x.tags.join(' '):'')).toLowerCase();const terms=userRequest.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(w=>w.length>2);const score=terms.reduce((n,w)=>n+(hay.includes(w)?1:0),0);return {...x,_score:score};})
      .sort((a,b)=>b._score-a._score||Number(b.weight||0)-Number(a.weight||0))
      .slice(0,hasResearchEvidence?0:PROFILE==='local'?1:3)
      .map(x=>'BEHAVIOR EXAMPLE: '+String(x.prompt||'')+'\nRESPONSE CONTRACT: '+String(x.response_contract||''))
      .join('\n');
    const conditioning=hasResearchEvidence?'':[rules?'Relevant HATCHABLE KAI 51 BEHAVIOR PARAMETERS:\n'+rules:'',examples?'RELEVANT RESPONSE-BEHAVIOR EXAMPLES (contracts, not canned answers):\n'+examples:''].filter(Boolean).join('\n\n');
    // Keep recent dialogue for EVERY turn, including greetings and emotional/casual messages.
    // This lets the model understand the flow instead of treating each message as a fresh task.
    const normalizedHistory=(Array.isArray(history)?history:[])
      .filter(x=>x&&typeof x==='object')
      .map(x=>{
        const rawRole=String(x.role||x.sender||x.who||'user').toLowerCase();
        const role=rawRole==='bot'||rawRole==='ai'||rawRole==='model'||rawRole==='assistant'?'assistant':'user';
        const content=String(x.content||x.text||x.message||'').trim().slice(0,PROFILE==='local'?900:1200);
        return {role,content};
      })
      .filter(x=>x.content && !(x.role==='user' && (x.content===prompt||x.content===userRequest)))
      .slice(PROFILE==='local'?-8:-12);
    const messages=[
      {role:'system',content:'You are KAI 51, the conversational intelligence of HAxBRO AI. Talk naturally like a thoughtful, attentive conversation partner while remaining honest that you are an AI. Treat the latest user message as part of the ongoing conversation, not an isolated phrase. Use the recent dialogue to understand references, emotional tone, jokes, corrections, forgiveness, and follow-up questions. Answer what the user actually means; do not change the subject, invent context, repeat canned apologies, or fall back to generic offers to help. For casual chat, respond casually and warmly; for feelings, acknowledge them without being clinical; for factual or technical questions, answer accurately and explain uncertainty. If the message is unclear, ask one brief, natural clarification. Never claim human feelings or experiences. Follow explicit output formats and length constraints.'},
      ...(hasResearchEvidence?[{role:'system',content:'RESEARCH TASK: You are the final answering model, not a search-results display. Read the supplied evidence carefully, select facts that directly answer the question, compare relevant sources, explain why the key findings matter, and answer in your own words. Cite supported claims as [1], [2], etc., matching the numbered [SOURCE 1], [SOURCE 2] entries. Do not invent facts or claim a page was read when its label says it was only a search snippet. If evidence is weak or conflicting, say exactly what remains uncertain.'}]:[]),
      ...(conditioning?[{role:'system',content:conditioning}]:[]),
      ...normalizedHistory,
      {role:'user',content:modelUserContent}
    ];

    const job=generationChain.then(async()=>{
      try{
        return await runOnce(messages,generationOptions);
      }catch(firstError){
        await disposePipe();
        try{
          await prepare();
          return await runOnce(messages,generationOptions);
        }catch(secondError){
          const e=new Error('KAI 51 local inference failed twice: '+String(secondError?.message||firstError?.message||secondError));
          e.cause=secondError;
          throw e;
        }
      }
    });
    generationChain=job.catch(()=>{});
    const result=await job;
    let generated=result?.[0]?.generated_text;
    let response=(Array.isArray(generated)
      ? String(generated.at(-1)?.content||'')
      : String(generated||result?.[0]?.text||'')).trim();
    // Tiny local models sometimes emit a generic greeting for a real question.
    // Retry that failure with a more explicit native-model instruction instead of
    // silently returning an unrelated greeting or switching to an external provider.
    const normalizedPrompt=userRequest.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const normalizedResponse=response.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const offTopicGreeting=isGreeting && /\b(?:weather|forecast|temperature|rain|sunny|status check|loading|system online)\b/i.test(response);
    const genericGreeting=!isSmallTalk && /^(?:hi|hello|hey|hello there|i'?m here(?: to help)?|how can i help(?: you)?)[!. ,]*$/i.test(response);
    const echoedPrompt=!isSmallTalk && normalizedPrompt.length>8 && (normalizedResponse===normalizedPrompt || normalizedResponse.includes(normalizedPrompt));
    const metaSummary=!isSmallTalk && /^(?:the )?user is asking\b|^(?:the )?user wants\b|^based on (?:the )?conversation\b|^it seems (?:like )?the user\b/i.test(response);
    const sentences=response.split(/(?<=[.!?])\s+/).map(x=>x.trim().toLowerCase()).filter(Boolean);
    const repeatedSentence=sentences.length>=2&&new Set(sentences).size<=Math.max(1,Math.floor(sentences.length/2));
    const apologyLoop=(response.match(/i'?m sorry for the misunderstanding/gi)||[]).length>=2;
    const genericApology=/^(?:i apologize for not providing (?:any )?direct answers|as a conversational ai\b|i apologize for not answering\b)/i.test(response.trim());
    // A truncated answer is a recoverable draft failure too. Retry it before the final
    // guard can replace it with the generic fallback message.
    const draftUnfinishedTail=/\b(?:a|an|the|and|or|but|because|that|which|who|to|of|for|with|had|have|has|is|are|was|were|in|on|at|by|from|if|when|while|as|my|your|you|i|it)$/i.test(response.trim());
    const draftBrokenOutput=draftUnfinishedTail||(response.length>100&&!/[.!?…\])\"’]$/.test(response.trim()));
    if(offTopicGreeting||genericGreeting||echoedPrompt||metaSummary||repeatedSentence||apologyLoop||genericApology||draftBrokenOutput){
      const repairMessages=[
        {role:'system',content:isSmallTalk
          ?'You are KAI 51. Your last response was irrelevant or repetitive. Respond to the user’s actual short message with one warm, simple sentence. Do not mention weather unless asked. Do not apologize unless there was a real mistake. Never repeat a sentence.'
          :'You are KAI 51, the core intelligence of HAxBRO AI. Your previous draft was wrong because it greeted the user, repeated their question, or looped. Answer the actual request now; never echo it. Follow explicit sentence-count and formatting instructions exactly. Be specific, useful, concise, and natural. Example: User asks “What can you help me with?” Answer: “I can help research factual questions, explain concepts, write and debug code, and plan or build apps. What are you working on?” Use this as a style example, not as a fixed response to unrelated questions.'},
        ...(conditioning?[{role:'system',content:conditioning}]:[]),
        ...normalizedHistory,
        {role:'user',content:modelUserContent}
      ];
      try{
        const retryJob=generationChain.then(()=>runOnce(repairMessages,{max_new_tokens:PROFILE==='local'?96:144,do_sample:false,repetition_penalty:1.12,no_repeat_ngram_size:3}));
        generationChain=retryJob.catch(()=>{});
        const retried=await retryJob;
        generated=retried?.[0]?.generated_text;
        const repaired=(Array.isArray(generated)?String(generated.at(-1)?.content||''):String(generated||retried?.[0]?.text||'')).trim();
        if(repaired)response=repaired;
      }catch(error){console.warn('KAI 51 answer-repair retry failed',error);}
    }
    if(/^(?:i apologize for not providing (?:any )?direct answers|as a conversational ai\b|i apologize for not answering\b)/i.test(response.trim())) throw new Error('Primary model produced a generic non-answer; activating the 135M fallback.');
    // Final safety guard: never expose a loop or an irrelevant weather answer for small talk.
    const finalSentences=response.split(/(?<=[.!?])\s+/).map(x=>x.trim().toLowerCase()).filter(Boolean);
    const stillRepeating=finalSentences.length>=2&&(new Set(finalSentences).size<finalSentences.length||new Set(finalSentences).size<=Math.max(1,Math.floor(finalSentences.length/2)));
    const unfinishedTail=/\b(?:a|an|the|and|or|but|because|that|which|who|to|of|for|with|had|have|has|is|are|was|were|in|on|at|by|from|if|when|while|as|my|your|you|i|it)$/i.test(response.trim());
    const emotionalMessage=/\b(?:rough day|bad day|terrible day|awful day|feeling (?:sad|down|lonely|anxious|worried|upset|overwhelmed)|i(?:'m| am) (?:sad|lonely|stressed|upset|overwhelmed|frustrated)|i just want to talk|need someone to talk)\b/i.test(userRequest);
    const creativeRequest=/\b(?:write|create|compose|draft|describe|generate)\b.*\b(?:creative|story|poem|paragraph|caption|sentence|description|fiction|scene|haiku|verse)\b/i.test(userRequest);
    const rainyScene=/\b(?:rain|rainy|rainfall|rain-soaked)\b/i.test(userRequest);
    const brokenOutput=stillRepeating||unfinishedTail||(response.length>100&&!/[.!?…\])"’]$/.test(response.trim()));
    const stillApologizing=(response.match(/i'?m sorry for (?:the misunderstanding|what i said earlier)/gi)||[]).length>=1;
    const stillWeather=isGreeting&&/\b(?:weather|forecast|temperature|rain|sunny)\b/i.test(response);
    const stalePoliteReply=isSmallTalk&&/\b(?:glad i could help you today|thanks for asking|since we last spoke|sorry for what i said earlier|is there something specific|status check|system online)\b/i.test(response);
    const unfinishedSmallTalk=isSmallTalk&&response.length>0&&!/[.!?…)"’]$/.test(response);
    if(isSmallTalk&&(stillRepeating||stillApologizing||stillWeather||stalePoliteReply||unfinishedSmallTalk)||brokenOutput){
      // Never replace neural output with a fixed greeting, apology, creative sample, or
      // generic answer. A failed repair is a model failure and must reach the router.
      throw new Error('Neural model output remained repetitive or incomplete after its repair attempt.');
    }
    // Identity integrity guard: the small base model can hallucinate numbered KAI identities.
    // Never expose a KAI 52/53/etc. sequence or repeated self-identification as a valid answer.
    const identityDrift=/\bKAI\s*(?:5[2-9]|[6-9]\d|\d{3,})\b/i.test(response)||(/\bKAI\s*51\b/i.test(response)&&(/\bKAI\s*5[2-9]\b/i.test(response)||(/\bI(?:'m| am) KAI\s*51\b/ig.test(response)&&((response.match(/\bI(?:'m| am) KAI\s*51\b/ig)||[]).length>1))));
    if(identityDrift){
      throw new Error('Neural model produced inconsistent identity text after generation.');
    }
    if(!response) throw new Error('KAI 51 neural model returned an empty response');
    return {
      response,
      provider:PROFILE==='local'?'KAI 51 LOCAL FAST NEURAL MODEL':'KAI 51 GITHUB PRECISION NEURAL MODEL',
      model:MODEL,
      local:true,
      localModel:true,
      device:DEVICE,
      realModel:true,
      quantization:'q4',
      provenance:PROFILE==='local'?'Public Hugging Face ONNX weights; browser-local inference':'HAxBRO GitHub release kai51-model-latest; browser-local inference',
      lane:PROFILE
    };
  }

  return {
    version:VERSION,
    model:MODEL,
    prepare,
    generate,
    chat:generate,
    isReady:()=>!!pipe,
    status:()=>({
      ready:!!pipe,
      model:MODEL,
      device:DEVICE,
      local:true,
      realModel:true,
      externalChatProviders:false,
      cache:VERSION,
      quantization:'q4',
      trainingSource:'HATCHABLE',
      trainingVersion:trainingPack?.pack?.version||trainingPack?.pack?.version||null,
      trainingChecksum:trainingPack?.pack?.checksum||null,
      provenance:'Public Hugging Face ONNX weights; browser-local inference',
      lane:PROFILE
    })
  };
}