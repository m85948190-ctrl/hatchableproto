export const access = "public";
export const methods = ["GET", "OPTIONS"];

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

export default async function(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET required" });
  res.setHeader("cache-control", "no-store");
  const live = {
    auto: false, openrouter: false, groq: false, mistral: false,
    cerebras: false, google: false, openai: false, kai51: true,
    kai89: false, kaiLite: false
  };
  return res.json({
    ok: true,
    live,
    configured: { ...live },
    model: {
      name: "Qwen2.5-Coder-0.5B-Instruct",
      base: "Qwen/Qwen2.5-Coder-0.5B-Instruct",
      browserRuntime: "@wllama/wllama 2.3.7 · llama.cpp WebAssembly",
      format: "GGUF",
      quantization: "Q4_K_M",
      parameterClass: "0.5B (approximately 0.6B rounded)",
      approximateDownload: "about 398 MB (379 MiB)",
      inference: "local browser inference; no hosted chat provider",
      devices: { laptop: "same Q4_K_M GGUF model", mobile: "same Q4_K_M GGUF model" },
      research: { sharedAcrossDevices: true, webSearch: ["Google", "Bing", "DuckDuckGo"], wikipedia: "search plus article-text extraction", webpageReading: "managed read-only browser extraction", synthesis: "the shared on-device Qwen2.5-Coder model" },
      autoInstallOnVisit: true,
      browserCache: true,
      codingMode: true,
      fineTuning: { method: "PEFT/LoRA", status: "training pipeline prepared; fine-tuned weights not yet produced" }
    },
    readiness: "This endpoint reports configuration only. Each browser reports ready only after the local GGUF model completes its inference self-test."
  });
}