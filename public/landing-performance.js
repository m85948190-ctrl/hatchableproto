(() => {
  const video=document.querySelector(".haxbro-landing-ambient-video");
  if(!video)return;
  const motion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const desktop=window.matchMedia?.("(min-width: 721px)")?.matches;
  const saveData=navigator.connection?.saveData===true;
  video.pause();
  if(motion||!desktop||saveData){video.preload="none";return;}
  video.preload="none";
  const play=()=>{video.play?.().catch(()=>{});};
  if(typeof requestIdleCallback==="function")requestIdleCallback(play,{timeout:3500});
  else setTimeout(play,1800);
})();