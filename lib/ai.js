// The Claude client. On Vercel it goes through AI Gateway and signs in with the
// deployment's own OIDC token, so no AI key needs to be stored. ANTHROPIC_API_KEY or
// AI_GATEWAY_API_KEY take over when set. SLIPP_MODEL picks the model: a Claude id such as
// claude-haiku-5-5, or any AI Gateway model such as spacexai/grok-4.3.
const Anthropic = require("@anthropic-ai/sdk").default;

const DEFAULT_MODEL = "claude-opus-5-5";

let override = null; // tests plug in a fake client here

function claude(oidcToken) {
  if (override) return override;
  const model = process.env.SLIPP_MODEL || DEFAULT_MODEL;
  if (process.env.ANTHROPIC_API_KEY) return { client: new Anthropic(), model };
  const apiKey = process.env.AI_GATEWAY_API_KEY || oidcToken || process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) throw Object.assign(new Error("No AI access: deploy on Vercel, or set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY."), { status: 500 });
  // AI Gateway names models like anthropic/claude-opus-5.5.
  const gatewayModel = model.includes("/") ? model : `anthropic/${model.replace(/-(\d+)-(\d+)$/, "-$1.$2")}`;
  return { client: new Anthropic({ apiKey, baseURL: "https://ai-gateway.vercel.sh" }), model: gatewayModel };
}

module.exports = { claude, useClaude: (c) => { override = c; }, Anthropic };
