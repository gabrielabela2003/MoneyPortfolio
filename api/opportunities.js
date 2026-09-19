const ALLOWED_ORIGIN = "https://gabrielabela2003.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

function send(res, status, body) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(body);
}

function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of (data?.output || [])) {
    for (const content of (item?.content || [])) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (_) {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("The AI returned an invalid JSON response.");
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!process.env.OPENAI_API_KEY) return send(res, 500, { error: "OPENAI_API_KEY is not configured in Vercel." });

  try {
    const input = req.body || {};
    if (!Array.isArray(input.holdings) || !Array.isArray(input.candidates)) {
      return send(res, 400, { error: "Invalid portfolio or candidate data." });
    }

    const systemPrompt = `
You are the opportunity-scanning engine for Ledger, a personal portfolio tracker.

Provide neutral, risk-aware research support using ONLY the supplied portfolio and candidate data.
Do not claim certainty or guaranteed profit. Do not invent current fundamentals, valuation metrics,
news, analyst ratings, forecasts, ETF holdings, or facts that are not supplied.

The purpose is to identify candidates that may COMPLEMENT the user's existing portfolio.
This is not a prediction contest and the highest score is not a guarantee of performance.

For each candidate:
- assetScore 0-100 = how interesting the candidate is based on the supplied data only.
- portfolioFit 0-100 = how suitable adding the candidate would be for this specific portfolio.
- action = CONSIDER, WATCH, or PASS.
- reason = concise explanation tied to supplied facts.

Portfolio-fit rules:
- Use current allocation, sector exposure, concentration threshold, and candidate sector.
- Prefer candidates that can reduce concentration or add a materially different exposure when the
  supplied data supports that conclusion.
- A candidate that overlaps heavily with the user's existing exposure can have a lower portfolioFit
  even if its assetScore is higher.
- Do not assume that an ETF is automatically diversified enough for this portfolio.
- Do not penalize a candidate merely because it has a positive or negative day change; daily movement
  is context, not a buy signal.
- If the available data is too limited to distinguish candidates confidently, say so and use WATCH.
- Never invent a ticker that was not supplied.
- Do not automatically recommend buying anything; the user makes the final decision.

Return only valid JSON:
{
  "summary":"short scanner summary",
  "opportunities":[
    {"ticker":"VOO","assetScore":0,"portfolioFit":0,"action":"CONSIDER | WATCH | PASS","reason":"short reason"}
  ]
}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI opportunity error:", data);
      return send(res, response.status, { error: data?.error?.message || "Opportunity scan failed." });
    }

    const result = parseJSON(extractText(data));
    const validTickers = new Set(input.candidates.map(c => String(c?.ticker || "").toUpperCase()));
    const opportunities = Array.isArray(result.opportunities) ? result.opportunities : [];

    result.opportunities = opportunities
      .filter(o => validTickers.has(String(o?.ticker || "").toUpperCase()))
      .map(o => ({
        ticker: String(o.ticker).toUpperCase(),
        assetScore: Math.max(0, Math.min(100, Number(o.assetScore) || 0)),
        portfolioFit: Math.max(0, Math.min(100, Number(o.portfolioFit) || 0)),
        action: ["CONSIDER", "WATCH", "PASS"].includes(o.action) ? o.action : "WATCH",
        reason: String(o.reason || "")
      }));

    result.summary = String(result.summary || "");
    return send(res, 200, result);
  } catch (error) {
    console.error("Opportunity function error:", error);
    return send(res, 500, { error: error.message || "Internal server error." });
  }
};
