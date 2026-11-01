(() => {
  const userModelKey = () => {
    const n = String(localStorage.getItem("haxbro_username") || "anonymous-device").trim().toLowerCase().replace(/[^a-z0-9._-]/g,"_").slice(0,64) || "anonymous-device";
    return "haxbro:user:" + n + ":model_choice";
  };
  function lockToGemma() {
    try { localStorage.setItem(userModelKey(),"kai-router"); } catch {}
    window.HAxBROSelectedModel = "kai-router";
    document.documentElement.dataset.haxbroModel = "kai-router";
    const label = document.getElementById("selectedModelLabel");
    if (label) label.textContent = "KAI · GEMMA 3 1B";
    const picker = document.getElementById("modelPickerBtn");
    if (picker) {
      picker.setAttribute("aria-disabled","true");
      picker.style.cursor = "default";
      picker.style.pointerEvents = "none";
      picker.setAttribute("aria-expanded","false");
      picker.title = "KAI uses one local model: Gemma 3 1B";
    }
    const menu = document.getElementById("modelPickerMenu");
    if (menu) {
      menu.hidden = true;
      menu.style.display = "none";
      menu.replaceChildren();
    }
    document.querySelectorAll(".model-option").forEach(option => option.remove());
    const hint = document.querySelector(".chat-panel .hint");
    if (hint) hint.textContent = "Gemma 3 1B · on-device WebGPU · first download about 1 GB · Enter to send";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",lockToGemma,{once:true});
  else lockToGemma();
  window.addEventListener("haxbro:username-changed",lockToGemma);
  window.addEventListener("haxbro:model-selected",lockToGemma);
})();