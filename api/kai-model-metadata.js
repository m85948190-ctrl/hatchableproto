export const access = "public";
export const methods = ["GET"];

const MODEL_BASES = {
  qwen:"https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/main/",
  smollm2:"https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX-MHA/resolve/main/"
};
const ALLOWED = new Set([
  "config.json",
  "generation_config.json",
  "tokenizer_config.json",
  "special_tokens_map.json"
]);

export default async function(req, res) {
  if (req.method !== "GET") return res.status(405).send("GET required");
  let file = "";
  let model = "qwen";
  try {
    const params = new URL(req.url, "https://haxbro.hatchable.site").searchParams;
    file = params.get("file") || "";
    model = params.get("model") || "qwen";
  } catch {}
  const modelBase = MODEL_BASES[model];
  if (!modelBase || !ALLOWED.has(file)) return res.status(400).json({ok:false,error:"Unsupported model metadata request"});
  try {
    const upstream = await fetch(modelBase + file, {headers:{accept:"application/json"}});
    if (!upstream.ok) return res.status(upstream.status).send("Model metadata upstream returned HTTP " + upstream.status);
    const body = await upstream.text();
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
    res.setHeader("x-content-type-options", "nosniff");
    return res.status(200).send(body);
  } catch (error) {
    return res.status(502).json({ok:false,error:"Could not retrieve model metadata: " + String(error?.message || error).slice(0,240)});
  }
}