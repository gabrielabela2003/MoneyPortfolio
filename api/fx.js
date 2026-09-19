const ALLOWED_ORIGIN = "https://gabrielabela2003.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}

function send(res, status, body) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(body);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return send(res, 405, { error: "GET only" });
  }

  try {
    const primary = await fetch(
      "https://api.frankfurter.dev/v2/providers/ecb/rate/eur/usd"
    );

    if (primary.ok) {
      const data = await primary.json();
      const rate = Number(data?.rate);
      if (Number.isFinite(rate) && rate > 0) {
        return send(res, 200, {
          base: "EUR", quote: "USD", rate,
          source: "ECB", date: data?.date || null
        });
      }
    }

    const fallback = await fetch("https://api.frankfurter.dev/v2/rate/eur/usd");
    if (!fallback.ok) {
      return send(res, 502, { error: "Unable to retrieve EUR/USD rate." });
    }

    const data = await fallback.json();
    const rate = Number(data?.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      return send(res, 502, { error: "Invalid EUR/USD rate." });
    }

    return send(res, 200, {
      base: "EUR", quote: "USD", rate,
      source: "Frankfurter", date: data?.date || null
    });
  } catch (error) {
    console.error("FX function error:", error);
    return send(res, 502, { error: "Unable to retrieve EUR/USD rate." });
  }
};
