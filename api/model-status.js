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
    auto: false,
    openrouter: false,
    groq: false,
    mistral: false,
    cerebras: false,
    google: false,
    openai: false,
    kai51: true,
    kai89: false,
    kaiLite: false
  };
  return res.json({
    ok: true,
    live,
    configured: { ...live },
    model: {
      name: "Qwen3-0.6B",
      base: "Qwen/Qwen3-0.6B",
      browserRuntime: "onnx-community/Qwen3-0.6B-ONNX",
      parameterClass: "0.6B",
      inference: "local browser inference; no hosted chat provider",
      desktop: { preferred: "WebGPU", quantization: "q4f16", fallback: "CPU/WASM q4 using the same Qwen3 weights" },
      phone: { model: "SmolLM2-135M-Instruct", browserRuntime: "onnx-community/SmolLM2-135M-Instruct-ONNX-MHA", preferred: "WebGPU Q4F16", fallback: "CPU/WASM Q4 using the same phone model", approximateDownload: "118 MB WebGPU Q4F16; about 182 MB CPU Q4" },
      research: { sharedAcrossBothDeviceModels: true, webSearch: ["Google", "Bing", "DuckDuckGo"], wikipedia: "search plus article-text extraction", webpageReading: "managed read-only browser extraction", synthesis: "the selected on-device model" },
      autoInstallOnVisit: true,
      browserCache: true,
      codingMode: true,
      fineTuning: { method: "PEFT/LoRA", status: "training pipeline prepared; fine-tuned weights not yet produced" }
    },
    readiness: "This endpoint reports configuration only. Each browser reports its selected device model ready only after that model completes its own local inference self-test."
  });
}