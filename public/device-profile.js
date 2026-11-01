(() => {
  const ua = String(navigator.userAgent || "");
  const mobileHint = navigator.userAgentData?.mobile === true;
  const handheld = mobileHint || /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  window.HAxBRO_DEVICE = handheld ? (ios ? "ios" : "android") : "desktop";
  window.HAxBRODeviceProfile = Object.freeze({
    device: window.HAxBRO_DEVICE,
    isPhone: handheld,
    isDesktop: !handheld,
    model: handheld ? "SmolLM2 135M Instruct" : "Google Gemma 3 1B Instruct",
    downloadLabel: handheld ? "about 118 MB of Q4F16 weights" : "about 1 GB"
  });
  document.documentElement.dataset.haxbroDevice = window.HAxBRO_DEVICE;
})();