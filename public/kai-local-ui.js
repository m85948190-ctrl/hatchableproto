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
    // Model selection is intentionally identical on phones and computers.
    if (label) label.textContent = "KAI · QWEN2.5-CODER 0.5B";
    const picker = document.getElementById("modelPickerBtn");
    if (picker) {
      picker.setAttribute("aria-disabled","true");
      picker.style.cursor = "default";
      picker.style.pointerEvents = "none";
      picker.setAttribute("aria-expanded","false");
      picker.title = "KAI uses one shared Qwen2.5-Coder 0.5B Q4_K_M model locally on every device (about 398 MB / 379 MiB).";
    }
    const menu = document.getElementById("modelPickerMenu");
    if (menu) {
      menu.hidden = true;
      menu.style.display = "none";
      menu.replaceChildren();
    }
    document.querySelectorAll(".model-option").forEach(option => option.remove());
    const hint = document.querySelector(".chat-panel .hint");
    if (hint) hint.textContent = "Qwen2.5-Coder 0.5B · same local model on laptop and mobile · Enter to send";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",lockToDeviceModel,{once:true});
  else lockToDeviceModel();
  window.addEventListener("haxbro:username-changed",lockToDeviceModel);
  window.addEventListener("haxbro:model-selected",lockToDeviceModel);
})();