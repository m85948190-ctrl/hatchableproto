(() => {
  const userModelKey = () => {
    const n = String(localStorage.getItem("haxbro_username") || "anonymous-device").trim().toLowerCase().replace(/[^a-z0-9._-]/g,"_").slice(0,64) || "anonymous-device";
    return "haxbro:user:" + n + ":model_choice";
  };
  function lockToDeviceModel() {
    try { localStorage.setItem(userModelKey(),"kai-router"); } catch {}
    window.HAxBROSelectedModel = "kai-router";
    document.documentElement.dataset.haxbroModel = "kai-router";
    const label = document.getElementById("selectedModelLabel");
    const phone = window.HAxBRODeviceProfile?.isPhone === true || window.HAxBRO_DEVICE === "ios" || window.HAxBRO_DEVICE === "android";
    if (label) label.textContent = phone ? "KAI · SMOLLM2 135M" : "KAI · GEMMA 3 1B";
    const picker = document.getElementById("modelPickerBtn");
    if (picker) {
      picker.setAttribute("aria-disabled","true");
      picker.style.cursor = "default";
      picker.style.pointerEvents = "none";
      picker.setAttribute("aria-expanded","false");
      picker.title = phone ? "KAI uses the local 135M-parameter phone model (about 118 MB Q4F16)" : "KAI uses local Gemma 3 1B on this computer";
    }
    const menu = document.getElementById("modelPickerMenu");
    if (menu) {
      menu.hidden = true;
      menu.style.display = "none";
      menu.replaceChildren();
    }
    document.querySelectorAll(".model-option").forEach(option => option.remove());
    const hint = document.querySelector(".chat-panel .hint");
    if (hint) hint.textContent = phone ? "SmolLM2 135M · on-device inference · about 118 MB on WebGPU · Enter to send" : "Gemma 3 1B · on-device WebGPU · first download about 1 GB · Enter to send";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",lockToDeviceModel,{once:true});
  else lockToDeviceModel();
  window.addEventListener("haxbro:username-changed",lockToDeviceModel);
  window.addEventListener("haxbro:model-selected",lockToDeviceModel);
})();