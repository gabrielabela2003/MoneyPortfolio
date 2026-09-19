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

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    portfolioScore: { type: "number" },
    monthlyDecision: { type: "string", enum: ["INVEST", "PARTIAL", "WAIT"] },
    recommendedAmount: { type: "number" },
    recommendedTicker: { type: ["string", "null"] },
    reasoning: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    holdings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
          score: { type: "number" },
          portfolioFit: { type: "number" },
          action: { type: "string", enum: ["BUY", "HOLD", "REDUCE", "SELL"] },
          reason: { type: "string" }
        },
        required: ["ticker", "score", "portfolioFit", "action", "reason"]
      }
    },
    candidateComparison: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
          source: { type: "string", enum: ["existing", "watchlist", "scanner"] },
          assetScore: { type: "number" },
          portfolioFit: { type: "number" },
          currentAllocation: { type: "number" },
          postAllocation: { type: "number" },
          action: { type: "string", enum: ["CONSIDER", "HOLD", "WATCH", "PASS"] },
          reason: { type: "string" }
        },
        required: ["ticker", "source", "assetScore", "portfolioFit", "currentAllocation", "postAllocation", "action", "reason"]
      }
    }
  },
  required: ["portfolioScore", "monthlyDecision", "recommendedAmount", "recommendedTicker", "reasoning", "risks", "holdings", "candidateComparison"]
};

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
    if (!Array.isArray(portfolio.candidatePool)) return send(res, 400, { error: "Candidate pool is missing." });

    const candidateTickers = new Set(portfolio.candidatePool.map(c => String(c?.ticker || "").toUpperCase()).filter(Boolean));

    const systemPrompt = `
You are the AI analysis engine for a personal portfolio tracker called Ledger.

Provide neutral, risk-aware decision support from ONLY the supplied portfolio data.
Do not claim certainty or guaranteed profit. Do not invent live prices, news, fundamentals,
analyst ratings, valuation metrics, forecasts, or facts that are not present in the input.

CORE FAIRNESS RULE:
The candidatePool is the authoritative set of assets that may receive the monthly contribution.
It intentionally combines:
1) existing holdings,
2) watchlist assets, and
3) scanner candidates.
The "source" field is provenance only. NEVER give an asset a scoring or recommendation advantage
because it is already owned, on the watchlist, or from the scanner. Existing holdings are allowed
to win when adding to them improves the portfolio, but new/watchlist/scanner assets must be able
to win when they fit the portfolio better.

IMPORTANT: Separate three questions:
A) ASSET SCORE = supplied-data assessment of the asset itself.
B) PORTFOLIO FIT = how suitable adding this asset is for THIS portfolio now.
C) MONTHLY DECISION = whether and how much of the monthly contribution to deploy.

A) STABLE PORTFOLIO ASSESSMENT
- portfolioScore assesses the portfolio structure and supplied asset data only.
- holdings.score assesses the existing holding using supplied asset information, allocation,
  sector exposure, gain/loss and concentration. It must not change merely because the contribution changes.
- holdings scores and portfolioScore should be materially stable when the portfolio is unchanged.
- portfolioFit is NOT the same as asset quality. A high-quality asset can have low fit if it is
  oversized or overlaps heavily with current exposure.

B) FAIR CANDIDATE COMPARISON
- Compare EVERY candidatePool item. Do not omit candidates because they are new or unfamiliar.
- Use candidatePool.currentAllocation as the authoritative current portfolio weight.
- Use candidatePool.postAllocation as the portfolio weight if the FULL monthly contribution were
  directed to that candidate. This is a deterministic scenario supplied by Ledger.
- Consider allocation change, concentration, sector/geographic/asset-class overlap, and diversification.
- A candidate already owned may have currentAllocation > 0; a new candidate normally has 0%.
- Existing ownership is not inherently positive or negative.
- A new position is not inherently better or worse than adding to an existing position.
- Do not treat a broad ETF as automatically better than a single stock, and do not treat an ETF
  as immune to portfolio concentration.
- Use the supplied assetType and exposure metadata to understand broad characteristics.
- Broker availability matters: prefer candidates marked availability='confirmed_existing' or availability='confirmed'; do not treat availability='verify_in_app' as confirmed executable availability. If the best-fit candidate is only marked verify_in_app, clearly state that the user must verify the ticker in Revolut before acting.
- If data is missing, lower confidence and say so rather than inventing information.
- Do not use dayChangePct or a recent gain/loss as a standalone buy signal.
- For each candidate, return assetScore, portfolioFit, action and a concise reason.
- Use action CONSIDER for candidates that are plausible monthly destinations, HOLD for existing
  positions that should generally be maintained without adding now, WATCH for candidates worth
  monitoring but not using for the contribution now, and PASS when portfolio fit/data is weak.
- The candidateComparison should include EVERY candidatePool item exactly once.

C) MONTHLY CONTRIBUTION DECISION
- First compare the full candidate pool; only then choose INVEST, PARTIAL or WAIT.
- recommendedTicker MUST be either null or one of the candidatePool tickers.
- Do not recommend a ticker outside candidatePool.
- If an existing holding has the best portfolio fit, it may be recommended.
- If a watchlist/scanner candidate has the best portfolio fit, it may be recommended instead.
- If no candidate is sufficiently supported by the supplied data, WAIT is valid.
- A large contribution relative to the portfolio can justify PARTIAL/staging.
- If WAIT, recommendedAmount must be 0 and recommendedTicker should normally be null.
- If INVEST, use the full contribution only when the supplied data supports full deployment.
- PARTIAL means some deployment is supported but full deployment is not.
- The recommendation should be explainable from the candidate comparison rather than from the asset's source.

D) CURRENT-HOLDING ACTIONS
- BUY = adding to this holding is supported by the portfolio-aware assessment.
- HOLD = keep roughly as-is; do not use it as the monthly destination.
- REDUCE = concentration/portfolio fit is high enough that reducing exposure should be considered.
- SELL = reserve for a strong risk/data reason; do not use simply because a position is down.
- A loss alone is NOT a buy signal.
- If an individual stock is above the concentration threshold, normally HOLD/REDUCE.
- If a diversified ETF is above the threshold, its diversification does not justify indefinite additions.

E) DATA LIMITATIONS
- Use valueEUR and allocation as authoritative portfolio valuation fields.
- The supplied current price is current available data, not a prediction.
- If fundamentals, valuation, news, or market conditions are absent, explicitly acknowledge that limitation.
- Do not infer that a candidate is attractive "right now" merely because its score is high.
- The user makes the final investment decision.

Return only the requested structured output.
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
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ledger_portfolio_analysis",
            strict: true,
            schema: RESPONSE_SCHEMA
          }
        }
      })
    });

    const data = await openaiResponse.json();
    if (!openaiResponse.ok) {
      console.error("OpenAI error:", data);
      return send(res, openaiResponse.status, { error: data?.error?.message || "OpenAI request failed." });
    }

    const text = extractText(data);
    const result = parseJSON(text);

    // Server-side validation keeps the recommendation constrained to Ledger's candidate pool.
    result.portfolioScore = Math.max(0, Math.min(100, Number(result.portfolioScore) || 0));
    const contribution = Number(portfolio.monthlyContribution) || 0;
    result.recommendedAmount = Math.max(0, Math.min(contribution, Number(result.recommendedAmount) || 0));
    if (!["INVEST", "PARTIAL", "WAIT"].includes(result.monthlyDecision)) result.monthlyDecision = "WAIT";
    if (result.monthlyDecision === "WAIT") result.recommendedAmount = 0;

    if (result.recommendedTicker !== null) {
      const rt = String(result.recommendedTicker).toUpperCase();
      result.recommendedTicker = candidateTickers.has(rt) ? rt : null;
    }

    if (!Array.isArray(result.risks)) result.risks = [];
    if (!Array.isArray(result.holdings)) result.holdings = [];
    if (!Array.isArray(result.candidateComparison)) result.candidateComparison = [];

    result.holdings = result.holdings.map(h => ({
      ticker: String(h?.ticker || ""),
      score: Math.max(0, Math.min(100, Number(h?.score) || 0)),
      portfolioFit: Math.max(0, Math.min(100, Number(h?.portfolioFit) || 0)),
      action: ["BUY", "HOLD", "REDUCE", "SELL"].includes(h?.action) ? h.action : "HOLD",
      reason: String(h?.reason || "")
    }));

    result.candidateComparison = result.candidateComparison
      .filter(c => candidateTickers.has(String(c?.ticker || "").toUpperCase()))
      .map(c => ({
        ticker: String(c?.ticker || "").toUpperCase(),
        source: ["existing", "watchlist", "scanner"].includes(c?.source) ? c.source : "scanner",
        assetScore: Math.max(0, Math.min(100, Number(c?.assetScore) || 0)),
        portfolioFit: Math.max(0, Math.min(100, Number(c?.portfolioFit) || 0)),
        currentAllocation: Math.max(0, Number(c?.currentAllocation) || 0),
        postAllocation: Math.max(0, Number(c?.postAllocation) || 0),
        action: ["CONSIDER", "HOLD", "WATCH", "PASS"].includes(c?.action) ? c.action : "WATCH",
        reason: String(c?.reason || "")
      }));

    // If the model omitted a candidate despite the prompt, surface the omission instead of
    // silently pretending the comparison was exhaustive.
    if (result.candidateComparison.length !== candidateTickers.size) {
      result.risks.push(`Candidate comparison was incomplete: ${result.candidateComparison.length} of ${candidateTickers.size} supplied candidates were returned.`);
    }

    return send(res, 200, result);
  } catch (error) {
    console.error("Analyze function error:", error);
    return send(res, 500, { error: error.message || "Internal server error." });
  }
};
