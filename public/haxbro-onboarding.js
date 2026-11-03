(()=>{'use strict';
const auth=window.hatchable&&window.hatchable.auth;
const login='/login?next='+encodeURIComponent('/app/');
const intro=document.getElementById('haxbroCinematicIntro');
const entry=document.getElementById('haxbroEntryGate');
const tour=document.getElementById('haxbroFeatureSequence');
const gate=document.getElementById('usernameGate');
if(entry)entry.hidden=true;
if(intro){intro.hidden=true;intro.querySelector('video')?.pause();}
if(tour)tour.hidden=true;
if(gate){gate.hidden=true;gate.setAttribute('aria-hidden','true');}
if(!auth||typeof auth.getSession!=='function'){location.replace(login);return;}
auth.getSession().then(result=>{
 const user=result&&result.user;
 if(!user){location.replace(login);return;}
 const identity=String(user.email||user.user_metadata?.full_name||user.user_metadata?.name||'HAxBRO member').trim();
 const display=identity.includes('@')?identity.split('@')[0]:identity;
 try{localStorage.setItem('haxbro_username',display.slice(0,32)||'HAxBRO member');}catch{}
 document.getElementById('promptInput')?.focus({preventScroll:true});
}).catch(()=>location.replace(login));
})();