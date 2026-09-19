const ALLOWED_ORIGIN = "https://gabrielabela2003.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"const ALLOWED_ORIGIN = "https://gabrielabela2003.github.io";

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
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of (data?.output || [])) {
    for (const content of (item?.content || [])) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_) {}

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

  if (req.method !== "POST") {
    return send(res, 405, { error: "POST only" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return send(res, 500, { error: "OPENAI_API_KEY is not configured in Vercel." });
  }

  try {
    const portfolio = req.body || {};

    if (!Array.isArray(portfolio.holdings)) {
      return send(res, 400, { error: "Invalid portfolio data." });
    }

    const systemPrompt = `
You are the AI analysis engine for a personal portfolio tracker called Ledger.

Your job is to provide neutral, risk-aware decision support from the supplied portfolio data.
Do not claim certainty or guaranteed profit. Do not invent live prices, news, fundamentals,
analyst ratings, or facts that are not present in the input.

The user contributes a monthly amount and wants help deciding:
1. whether to invest this month or wait,
2. how much of the monthly contribution to deploy,
3. whether to add to an existing holding or consider a watchlist asset,
4. a 0-100 score for each supplied holding,
5. an action label for each holding: BUY, HOLD, REDUCE, or SELL,
6. the main risks and reasoning.

Important:
- The supplied price is the current price available to Ledger, not a prediction.
- Use valueEUR and allocation as the authoritative portfolio valuation fields when present.
- Consider concentration, sector exposure, gains/losses, portfolio size, and the monthly contribution.
- Do not treat a currency conversion or ETF listing as a change in the underlying investment; it is only a data-normalization step.
- Do not use a high score as a guarantee of future performance.
- If the supplied data is insufficient for a strong conclusion, say so and choose a cautious action.
- The user is responsible for the final investment decision.

Return ONLY valid JSON with this exact top-level shape:
{
  "portfolioScore": 0,
  "monthlyDecision": "INVEST | PARTIAL | WAIT",
  "recommendedAmount": 0,
  "recommendedTicker": "TICKER or null",
  "reasoning": "short explanation",
  "risks": ["risk 1", "risk 2"],
  "holdings": [
    {"ticker":"AAPL","score":0,"action":"BUY | HOLD | REDUCE | SELL","reason":"short reason"}
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
      return send(res, openaiResponse.status, {
        error: data?.error?.message || "OpenAI request failed."
      });
    }

    const text = extractText(data);
    const result = parseJSON(text);

    return send(res, 200, result);
  } catch (error) {
    console.error("Analyze function error:", error);
    return send(res, 500, { error: error.message || "Internal server error." });
  }
};

  };
}

function send(res, status, body) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(body);
}

function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of (data?.output || [])) {
    for (const content of (item?.content || [])) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_) {}

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

  if (req.method !== "POST") {
    return send(res, 405, { error: "POST only" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return send(res, 500, { error: "OPENAI_API_KEY is not configured in Vercel." });
  }

  try {
    const portfolio = req.body || {};

    if (!Array.isArray(portfolio.holdings)) {
      return send(res, 400, { error: "Invalid portfolio data." });
    }

    const systemPrompt = `
You are the AI analysis engine for a personal portfolio tracker called Ledger.

Your job is to provide neutral, risk-aware decision support from the supplied portfolio data.
Do not claim certainty or guaranteed profit. Do not invent live prices, news, fundamentals,
analyst ratings, or facts that are not present in the input.

The user contributes a monthly amount and wants help deciding:
1. whether to invest this month or wait,
2. how much of the monthly contribution to deploy,
3. whether to add to an existing holding or consider a watchlist asset,
4. a 0-100 score for each supplied holding,
5. an action label for each holding: BUY, HOLD, REDUCE, or SELL,
6. the main risks and reasoning.

Important:
- The supplied price is the current price available to Ledger, not a prediction.
- Use valueEUR and allocation as the authoritative portfolio valuation fields when present.
- Consider concentration, sector exposure, gains/losses, portfolio size, and the monthly contribution.
- Do not treat a currency conversion or ETF listing as a change in the underlying investment; it is only a data-normalization step.
- Do not use a high score as a guarantee of future performance.
- If the supplied data is insufficient for a strong conclusion, say so and choose a cautious action.
- The user is responsible for the final investment decision.

Return ONLY valid JSON with this exact top-level shape:
{
  "portfolioScore": 0,
  "monthlyDecision": "INVEST | PARTIAL | WAIT",
  "recommendedAmount": 0,
  "recommendedTicker": "TICKER or null",
  "reasoning": "short explanation",
  "risks": ["risk 1", "risk 2"],
  "holdings": [
    {"ticker":"AAPL","score":0,"action":"BUY | HOLD | REDUCE | SELL","reason":"short reason"}
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
      return send(res, openaiResponse.status, {
        error: data?.error?.message || "OpenAI request failed."
      });
    }

    const text = extractText(data);
    const result = parseJSON(text);

    return send(res, 200, result);
  } catch (error) {
    console.error("Analyze function error:", error);
    return send(res, 500, { error: error.message || "Internal server error." });
  }
};
