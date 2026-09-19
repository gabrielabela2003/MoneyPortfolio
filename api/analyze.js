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
    const portfolio = req.body || {};
    if (!Array.isArray(portfolio.holdings)) return send(res, 400, { error: "Invalid portfolio data." });

    const systemPrompt = `
You are the AI analysis engine for a personal portfolio tracker called Ledger.

Provide neutral, risk-aware decision support from ONLY the supplied portfolio data.
Do not claim certainty or guaranteed profit. Do not invent live prices, news, fundamentals,
analyst ratings, valuation metrics, or facts that are not present in the input.

IMPORTANT: Separate PORTFOLIO/ASSET ASSESSMENT from MONTHLY CONTRIBUTION DECISION.

A) STABLE PORTFOLIO ASSESSMENT
- portfolioScore must assess the portfolio structure and supplied asset data ONLY.
- holdings.score must assess the holding using the supplied asset information, current allocation,
  sector exposure, gain/loss and concentration. It must NOT change merely because the monthly
  contribution amount changes.
- portfolioScore and holdings scores should therefore be materially stable when the portfolio
  itself is unchanged.
- For each holding, also calculate portfolioFit from 0-100: how suitable adding MORE of this
  holding would be for this specific portfolio right now. A high-quality asset can have a low
  portfolioFit if it is already too large or overlaps heavily with existing exposure.

B) PORTFOLIO-AWARE ACTIONS
- Use the supplied concentrationThreshold as a meaningful warning threshold.
- Treat individual stocks and diversified ETFs differently, but do NOT treat ETF diversification
  as permission to increase an already oversized allocation indefinitely.
- If an individual stock is above the concentration threshold, normally use HOLD or REDUCE and
  do not recommend adding to it unless the supplied data gives a compelling portfolio-level reason.
- If a diversified ETF is above the concentration threshold, acknowledge that its company-specific
  risk is lower, but its portfolio allocation is still material. Normally prefer HOLD rather than
  BUY when adding more would further increase an already-large position.
- A recommendation to add to an asset already above the threshold requires an explicit reason,
  and should be uncommon.
- Consider overlap: a broad US ETF still overlaps with US technology/semiconductor holdings.
- Do not confuse diversification within an ETF with diversification of the user's whole portfolio.
- If the best portfolio action is to avoid adding to every current holding, use WAIT or consider
  a supplied watchlist asset. Never invent a new ticker that was not supplied.
- The user-supplied watchlist is an active candidate set, not background information. When one or
  more watchlist assets are supplied, explicitly compare them with the existing holdings for the
  monthly contribution decision. Use their supplied ticker, name, sector, price and dayChangePct
  only; do not invent fundamentals, valuation, news, or other missing data.
- A watchlist asset may be selected as recommendedTicker when its portfolio fit is better than
  adding to an existing holding. If a watchlist candidate is selected, explain why it complements
  the portfolio and mention any overlap or missing-data limitations. If none is suitable, it is valid
  to recommend an existing holding or WAIT.

C) MONTHLY CONTRIBUTION DECISION
- Decide whether to INVEST, PARTIAL, or WAIT using the monthly contribution only AFTER assessing
  the portfolio.
- The recommended amount may change when the contribution changes, but the portfolioScore and
  holding scores should not be changed simply because the contribution is larger or smaller.
- Consider how much the contribution would change current allocations. A contribution that is
  large relative to the portfolio can justify staging/partial deployment when the available data
  does not support a strong full deployment.
- recommendedAmount must be between 0 and monthlyContribution.
- If monthlyDecision is WAIT, recommendedAmount should be 0.
- If monthlyDecision is INVEST, recommendedAmount can be the full contribution only when the
  portfolio and available supplied data support full deployment.
- PARTIAL should be used when some deployment is supported but full deployment is not.

D) ACTION LABELS
- BUY = adding to this holding is currently supported by the portfolio-aware assessment.
- HOLD = keep the position roughly as-is; do not use it as the monthly destination.
- REDUCE = position/concentration is high enough that reducing exposure should be considered.
- SELL = reserve for a strong risk/data reason; do not use simply because a position is down.
- A loss by itself is NOT a buy signal.

E) DATA LIMITATIONS
- Use valueEUR and allocation as authoritative portfolio valuation fields when present.
- The supplied price is current available data, not a prediction.
- If fundamentals, valuation, news, or market conditions are absent, explicitly acknowledge that
  limitation rather than filling the gap with invented claims.
- Currency conversion and ETF listing are data normalization only.
- The user makes the final investment decision.

Return ONLY valid JSON with this exact top-level shape:
{
  "portfolioScore": 0,
  "monthlyDecision": "INVEST | PARTIAL | WAIT",
  "recommendedAmount": 0,
  "recommendedTicker": "TICKER or null",
  "reasoning": "short explanation",
  "risks": ["risk 1", "risk 2"],
  "holdings": [
    {
      "ticker":"AAPL",
      "score":0,
      "portfolioFit":0,
      "action":"BUY | HOLD | REDUCE | SELL",
      "reason":"short reason"
    }
  ]
}
`;

    const userPrompt = JSON.stringify(portfolio);
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: userPrompt }] }
        ]
      })
    });

    const data = await openaiResponse.json();
    if (!openaiResponse.ok) {
      console.error("OpenAI error:", data);
      return send(res, openaiResponse.status, { error: data?.error?.message || "OpenAI request failed." });
    }

    const text = extractText(data);
    const result = parseJSON(text);

    // Lightweight server-side validation so the UI cannot receive obviously invalid ranges.
    result.portfolioScore = Math.max(0, Math.min(100, Number(result.portfolioScore) || 0));
    const contribution = Number(portfolio.monthlyContribution) || 0;
    result.recommendedAmount = Math.max(0, Math.min(contribution, Number(result.recommendedAmount) || 0));
    if (!["INVEST", "PARTIAL", "WAIT"].includes(result.monthlyDecision)) result.monthlyDecision = "WAIT";
    if (result.monthlyDecision === "WAIT") result.recommendedAmount = 0;
    if (!Array.isArray(result.risks)) result.risks = [];
    if (!Array.isArray(result.holdings)) result.holdings = [];
    result.holdings = result.holdings.map(h => ({
      ticker: String(h?.ticker || ""),
      score: Math.max(0, Math.min(100, Number(h?.score) || 0)),
      portfolioFit: Math.max(0, Math.min(100, Number(h?.portfolioFit) || 0)),
      action: ["BUY", "HOLD", "REDUCE", "SELL"].includes(h?.action) ? h.action : "HOLD",
      reason: String(h?.reason || "")
    }));

    return send(res, 200, result);
  } catch (error) {
    console.error("Analyze function error:", error);
    return send(res, 500, { error: error.message || "Internal server error." });
  }
};
