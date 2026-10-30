import { browser } from "hatchable";
export const access="public";
export const methods=["POST"];

const clean=(v,n=5000)=>String(v??"").replace(/\u0000/g,"").replace(/\s+/g," ").trim().slice(0,n);

function extractLinks(html){
  const out=[];const s=String(html||"");let m;
  const re=/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while((m=re.exec(s))&&out.length<8){
    let url=m[1].replace(/&amp;/g,"&");
    const title=clean(m[2].replace(/<[^>]+>/g," "));
    if(!title)continue;
    if(url.startsWith("/url?q="))try{url=decodeURIComponent(url.slice(7).split("&")[0])}catch{}
    if(url.startsWith("//"))url="https:"+url;
    if(/^https?:\/\//i.test(url)){
      try{const host=new URL(url).hostname;if(host.includes("google.")||host.includes("duckduckgo.")||host.includes("bing."))continue}catch{}
      if(!out.some(x=>x.url===url))out.push({title,url});
    }
  }
  return out;
}

const pageText=html=>clean(String(html||"").replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">"),9000);

async function googleSearch(query){
  // Google's current public HTML response is JS-only in this server environment;
  // do not pretend its empty shell is a set of search results.
  const url="https://www.google.com/search?gbv=1&hl=en&q="+encodeURIComponent(query);
  const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; HAxBROResearch/1.0)"}});
  if(!response.ok)return [];
  const html=await response.text();
  if(/\/httpservice\/retry\/enablejs|unusual traffic|sorry\/index/i.test(html))return [];
  const blocks=html.match(/<div class=["']MjjYud["'][\s\S]*?(?=<div class=["']MjjYud["']|<\/body>)/gi)||[];
  return blocks.slice(0,6).map(block=>{
    const anchor=block.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if(!anchor)return null;
    return {title:htmlText(anchor[2]),url:anchor[1],text:htmlText(block)};
  }).filter(x=>x?.title&&/^https?:/i.test(x.url));
}

function queryVariants(query){
  const q=clean(query,700).trim();
  if(!q)return [];
  const short=/^[a-z0-9][a-z0-9._-]{1,40}$/i.test(q);
  if(!short)return [q];
  return [
    `"${q}" meaning`,
    `"${q}" definition`,
    `"${q}" slang`,
    `"${q}" abbreviation`,
    `"${q}" typo`,
    `"${q}"`
  ];
}

function decodeBingTarget(href){
  const value=String(href||"").replace(/&amp;/g,"&");
  const match=value.match(/[?&]u=a1([A-Za-z0-9_=-]+)/);
  if(match){
    try{
      const binary=atob(match[1].replace(/-/g,"+").replace(/_/g,"/"));
      const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      const decoded=new TextDecoder().decode(bytes);
      if(/^https?:\/\//i.test(decoded))return decoded;
    }catch{}
  }
  try{const u=new URL(value);if(u.hostname.endsWith("bing.com"))return "";return u.href;}catch{return "";}
}
function htmlText(value){
  return clean(String(value||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">"),1400);
}
async function bingSearch(query){
  const url="https://www.bing.com/search?q="+encodeURIComponent(query);
  const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; HAxBROResearch/1.0)"}});
  if(!response.ok)throw new Error("Bing search HTTP "+response.status);
  const html=await response.text();
  const blocks=String(html||"").match(/<li\s+class=["'][^"']*b_algo[^"']*["'][\s\S]*?(?=<li\s+class=["'][^"']*b_algo[^"']*["']|<\/ol>)/gi)||[];
  const out=[];const seen=new Set();
  for(const block of blocks){
    const anchor=block.match(/<h2[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if(!anchor)continue;
    const target=decodeBingTarget(anchor[1]);
    const title=htmlText(anchor[2]);
    if(!target||!title||seen.has(target))continue;
    seen.add(target);
    const paragraph=block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const text=paragraph?htmlText(paragraph[1]):"";
    out.push({title,url:target,text});
    if(out.length>=8)break;
  }
  return out;
}

async function multiSearch(query,mode="fast"){
  const variants=queryVariants(query);
  const primary=variants.slice(0,mode==="deep"?3:1);
  // Run three independent public search engines in parallel. A failure in one
  // engine must not suppress results from the others.
  const deadline=mode==="deep"?12000:6000;
  const settled=await Promise.race([
    Promise.all([
      Promise.all(primary.map(async q=>{try{return await googleSearch(q)}catch{return []}})),
      Promise.all(primary.map(async q=>{try{return await bingSearch(q)}catch{return []}})),
      Promise.all(primary.map(async q=>{try{return await ddgSearch(q)}catch{return []}}))
    ]),
    new Promise(resolve=>setTimeout(()=>resolve([[],[],[]]),deadline))
  ]);
  const [googleResults,bingResults,ddgResults]=settled||[[],[],[]];
  const collect=(lists,engine,limit)=>{const out=[],seen=new Set();for(const list of lists||[])for(const x of list||[]){if(!x?.url||seen.has(x.url))continue;seen.add(x.url);out.push({...x,engine});if(out.length>=limit)return out;}return out;};
  const terms=clean(query,500).toLowerCase().match(/[a-z0-9]{4,}/g)||[];
  const stop=new Set(["what","when","where","which","that","this","with","from","does","have","your","about","into","they","them","their","there","then","than","were","will","would","could","should","also","just","some","more","most","much","many","make","made","work","works","using","used","based","explain","please","tell","show"]);
  const keyTerms=[...new Set(terms.filter(t=>!stop.has(t)))];
  const filterRelevant=rows=>rows.filter(x=>{
    if(!keyTerms.length)return true;
    const text=(x.title+" "+x.text).toLowerCase();
    const matches=keyTerms.filter(term=>text.includes(term)).length;
    // One generic word (e.g. "causes" or "lithium") must not make an unrelated
    // result look relevant. Require two topic terms whenever the query has two+.
    const required=keyTerms.length>=5?3:keyTerms.length>=3?2:1;
    return matches>=required;
  });
  const google=filterRelevant(collect(googleResults,"Google Web",6));
  const bing=filterRelevant(collect(bingResults,"Bing Web",6));
  const duckduckgo=filterRelevant(collect(ddgResults,"DuckDuckGo Instant Answers",6));
  const merged=[],seen=new Set();
  // Interleave providers so one engine cannot monopolize the evidence set.
  for(let i=0;i<Math.max(google.length,bing.length,duckduckgo.length);i++){
    for(const x of [google[i],bing[i],duckduckgo[i]])if(x&&!seen.has(x.url)){seen.add(x.url);merged.push(x);}
  }
  return {links:merged.slice(0,mode==="deep"?15:12),engine:[google.length?"Google Web":"",bing.length?"Bing Web":"",duckduckgo.length?"DuckDuckGo Instant Answers":""].filter(Boolean).join(" + ")||"No web search engine returned results",engines:{google:google.length,bing:bing.length,duckduckgo:duckduckgo.length}};
}

async function ddgSearch(query){
  // The HTML results page is presenting a human-verification challenge. Use the
  // official Instant Answer endpoint instead; it returns a smaller, honest data set.
  const url="https://api.duckduckgo.com/?q="+encodeURIComponent(query)+"&format=json&no_html=1&skip_disambig=1";
  const response=await fetch(url,{headers:{accept:"application/json"}});
  if(!response.ok)throw new Error("DuckDuckGo Instant Answer HTTP "+response.status);
  const data=await response.json();
  const out=[];
  if(data.AbstractText&&data.AbstractURL)out.push({title:data.Heading||data.AbstractSource||"DuckDuckGo instant answer",url:data.AbstractURL,text:clean(data.AbstractText,1600)});
  const addTopics=(items)=>{for(const item of items||[]){if(item?.FirstURL&&item?.Text)out.push({title:clean(item.Text.split(" - ")[0],180),url:item.FirstURL,text:clean(item.Text,900)});if(item?.Topics)addTopics(item.Topics);if(out.length>=6)break;}};
  addTopics(data.RelatedTopics);
  return out.slice(0,6);
}

async function wikipediaEvidence(query){
  const normalized=clean(query,300).replace(/^\s*(?:please\s+)?(?:what is|what are|who is|who are|where is|where are|tell me about|explain)\s+/i,"").replace(/\b(?:and|how|does|do|is|are|it|they|this|that|the|a|an|work|works|function|functions)\b/gi," ").replace(/[?!.]+$/,"").replace(/\s+/g," ").trim();
  const fetchSummary=async(title,timeout=1350)=>{
    const normalizedTitle=title.replace(/\s+/g,"_");
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const endpoint="https://en.wikipedia.org/api/rest_v1/page/summary/"+encodeURIComponent(normalizedTitle);
      const r=await fetch(endpoint,{signal:controller.signal,headers:{accept:"application/json"}});
      if(r.ok){
        const item=await r.json();
        if(item?.extract&&item.type!=="disambiguation"){
          const summary={title:item.title||title,url:item.content_urls?.desktop?.page||("https://en.wikipedia.org/wiki/"+encodeURIComponent(String(item.title||title).replace(/ /g,"_"))),text:clean(item.extract,1800),engine:"Wikipedia",readStatus:"wikipedia-summary"};
          // A short REST summary is useful, but the answer model needs article context.
          // Read the rendered article when available and keep the summary if blocked.
          try{
            const html=await Promise.race([browser.html(summary.url),new Promise(resolve=>setTimeout(()=>resolve(""),3500))]);
            const full=pageText(html);
            const blocked=/captcha|access denied|security verification|checking your browser|enable javascript/i.test(full);
            if(!blocked&&full.length>summary.text.length+250)return {...summary,text:full.slice(0,9000),readStatus:"wikipedia-article"};
          }catch{}
          return summary;
        }
      }
    }catch{}finally{clearTimeout(timer)}
    /* Some server runtimes block direct Wikipedia API fetches. Use the managed
       browser session as a second retrieval transport rather than returning a
       page title with an empty body. */
    try{
      const pageResult=await Promise.race([
        browser.session(async page=>{
          await page.goto("https://en.wikipedia.org/wiki/"+encodeURIComponent(normalizedTitle),{waitUntil:"domcontentloaded"});
          return await page.evaluate(()=>{
            const title=document.querySelector("#firstHeading")?.innerText||document.title||"";
            const paragraphs=Array.from(document.querySelectorAll("#mw-content-text .mw-parser-output > p"))
              .map(p=>(p.innerText||p.textContent||"").replace(/\s+/g," ").trim())
              .filter(t=>t.length>45&&!/may refer to|disambiguation/i.test(t));
            return {title,text:paragraphs.slice(0,3).join(" ")};
          });
        }),
        new Promise(resolve=>setTimeout(()=>resolve(null),1800))
      ]);
      if(pageResult?.text&&pageResult.text.length>45)return {title:clean(pageResult.title||title,220),url:"https://en.wikipedia.org/wiki/"+encodeURIComponent(normalizedTitle),text:clean(pageResult.text,1800),engine:"Wikipedia"};
    }catch{}
    return null;
  };
  /* Try the exact article first; this is faster and more accurate for clean topics. */
  if(normalized&&normalized.split(/\s+/).length===1){
    const direct=await fetchSummary(normalized,1000);
    if(direct)return [direct];
  }
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1500);
  try{
    const endpoint="https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch="+encodeURIComponent(normalized||query)+"&srlimit=4&format=json";
    const response=await fetch(endpoint,{signal:controller.signal,headers:{accept:"application/json"}});
    if(!response.ok)return [];
    const data=await response.json();
    const rows=Array.isArray(data?.query?.search)?data.query.search:[];
    const summaries=await Promise.all(rows.slice(0,3).map(row=>fetchSummary(String(row.title||""),1500)));
    const terms=normalized.toLowerCase().split(/\s+/).filter(w=>w.length>2&&!["the","and","for","with","from","what","who","when","where","how","current","latest","about"].includes(w));
    return summaries.filter(Boolean).map(x=>({...x,_score:terms.filter(t=>(x.title+" "+x.text).toLowerCase().includes(t)).length})).filter(x=>x._score>=(terms.length>=3?2:1)).sort((a,b)=>b._score-a._score).map(({_score,...x})=>x).slice(0,2);
  }catch{return []}finally{clearTimeout(timer)}
}

export default async function(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST required"});
  const query=clean(req.body?.query,700);
  if(!query)return res.status(400).json({error:"query required"});
  const mode=req.body?.mode==="deep"?"deep":"fast";
  try{
    const [searched,wiki]=await Promise.all([
      multiSearch(query,mode),
      wikipediaEvidence(query)
    ]);
    const links=searched.links||[];
    const take=mode==="deep"?6:3;
    // Open actual result pages, not just search snippets. Keep the snippet only
    // as a clearly marked fallback when a publisher page is unavailable.
    const pages=await Promise.all(links.slice(0,take).map(async x=>{
      const snippet=clean(x.text||"",1400);
      try{
        const timeout=mode==="deep"?10000:8500;
        const html=await Promise.race([browser.html(x.url),new Promise((_,reject)=>setTimeout(()=>reject(new Error("source timeout")),timeout))]);
        const text=pageText(html);
        const blocked=/just a moment|security verification|verify (?:that )?you are not a bot|confirm you.?re not a robot|unusual traffic|captcha|checking your browser|enable javascript and cookies to continue|access denied|you don.?t have permission|restricted country|request blocked|forbidden/i.test(text);
        if(text.length>180&&!blocked)return {...x,text:text.slice(0,9000),readStatus:"page-read"};
        return {...x,text:snippet,readStatus:snippet?"search-snippet-fallback":"unreadable"};
      }catch{return {...x,text:snippet,readStatus:snippet?"search-snippet-fallback":"unreadable"}}
    }));
    const combined=[...pages,...wiki.map(x=>({...x,readStatus:x.readStatus||"wikipedia-article"}))].filter(x=>x.text||x.title);
    const seen=new Set();
    const sources=combined.filter(x=>{const key=x.url||x.title;if(!key||seen.has(key))return false;seen.add(key);return true;}).slice(0,take+2);
    return res.json({ok:true,engine:[searched.engine,wiki.length?"Wikipedia":""].filter(Boolean).join(" + "),engines:searched.engines||{},mode,query,searchQueries:queryVariants(query),sources});
  }catch(e){
    return res.status(502).json({ok:false,error:"KAI web search unavailable",detail:clean(e?.message,300)});
  }
}