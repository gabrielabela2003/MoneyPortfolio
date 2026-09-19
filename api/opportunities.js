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
  Object.entries(corsHeaders()).forEach(([k,v]) => res.setHeader(k,v));
  return res.status(status).json(body);
}
function extractText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks=[];
  for (const item of (data?.output || [])) for (const content of (item?.content || [])) {
    if (typeof content?.text === "string") chunks.push(content.text);
  }
  return chunks.join("\n").trim();
}

const SCHEMA = {
  type:"object", additionalProperties:false,
  properties:{
    summary:{type:"string"},
    dataQuality:{type:"string", enum:["HIGH","MEDIUM","LOW"]},
    opportunities:{type:"array", items:{type:"object", additionalProperties:false, properties:{
      ticker:{type:"string"}, assetScore:{type:"number"}, portfolioFit:{type:"number"},
      action:{type:"string",enum:["CONSIDER","WATCH","PASS"]},
      reason:{type:"string"}, dataUsed:{type:"array",items:{type:"string"}}
    }, required:["ticker","assetScore","portfolioFit","action","reason","dataUsed"]}},
    researchNotes:{type:"array",items:{type:"string"}}
  },
  required:["summary","dataQuality","opportunities","researchNotes"]
};

module.exports = async (req,res) => {
  if(req.method === "OPTIONS") return send(res,204,{});
  if(req.method !== "POST") return send(res,405,{error:"POST only"});
  if(!process.env.OPENAI_API_KEY) return send(res,500,{error:"OPENAI_API_KEY is not configured in Vercel."});
  try {
    const input=req.body||{};
    if(!Array.isArray(input.holdings)||!Array.isArray(input.candidates)) return send(res,400,{error:"Invalid portfolio or candidate data."});
    const prompt=`You are Ledger's Phase 2 opportunity-research engine. Provide neutral, risk-aware research support using ONLY the supplied portfolio, live market data, fundamentals, and recent news.

IMPORTANT DATA RULES:
- Do not invent any number, valuation, fundamental, news item, forecast, analyst view, or ETF characteristic.
- A missing metric is genuinely missing; do not fill it from memory.
- Recent price movement is context, NOT a standalone buy signal.
- News is evidence/context, not a trading signal by itself. Distinguish reported facts from interpretations.
- ETF candidates may have quote/metadata/news but no company fundamentals. Do not penalize an ETF merely because stock-style metrics are unavailable.
- dataQuality must reflect actual supplied evidence: a valid quote plus appropriate asset-type evidence (ETF metadata for ETFs, fundamentals or news for stocks) counts as usable evidence.
- Do not claim a candidate is attractive "right now" solely from a high score.
- Portfolio fit considers current allocation, concentration, sector/geographic/asset-class overlap, and diversification.
- The user's final decision remains their own.

SCORING:
- assetScore 0-100 = quality/interestingness based on supplied live data and static metadata. If data is sparse, lower confidence and avoid false precision.
- portfolioFit 0-100 = suitability as a complement to this specific portfolio. A strong asset can have low fit when it overlaps or is already oversized.
- CONSIDER = plausible candidate for further review; WATCH = worth monitoring but insufficient support or fit for immediate consideration; PASS = weak fit or data-supported reason to deprioritize.
- Compare every supplied candidate exactly once.

BROKER:
- availability='confirmed_existing' means the user already owns it.
- availability='confirmed' means explicitly verified by the user/app.
- availability='verify_in_app' is NOT confirmed executable availability. If such a candidate scores well, say it must be checked in Revolut before acting.

Return only the structured output.`;
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:"gpt-5.6",input:[
        {role:"system",content:[{type:"input_text",text:prompt}]},
        {role:"user",content:[{type:"input_text",text:JSON.stringify(input)}]}
      ],text:{format:{type:"json_schema",name:"ledger_opportunity_research",strict:true,schema:SCHEMA}}})
    });
    const data=await response.json();
    if(!response.ok) return send(res,response.status,{error:data?.error?.message||"Opportunity research failed."});
    const result=JSON.parse(extractText(data));
    const valid=new Set(input.candidates.map(c=>String(c?.ticker||"").toUpperCase()));
    const candidateMap=new Map(input.candidates.map(c=>[String(c?.ticker||"").toUpperCase(), c]));
    result.opportunities=(Array.isArray(result.opportunities)?result.opportunities:[])
      .filter(o=>valid.has(String(o?.ticker||"").toUpperCase()))
      .map(o=>{
        const ticker=String(o.ticker).toUpperCase();
        const c=candidateMap.get(ticker)||{};
        // The client-side availability string is descriptive only. Actionability is gated
        // by the explicit boolean confirmation flag, which the UI sets only after
        // the user confirms the exact instrument in Revolut.
        const confirmed=c.revolutConfirmed===true;
        const requestedAction=["CONSIDER","WATCH","PASS"].includes(o.action)?o.action:"WATCH";
        return {ticker,assetScore:Math.max(0,Math.min(100,Number(o.assetScore)||0)),portfolioFit:Math.max(0,Math.min(100,Number(o.portfolioFit)||0)),action:confirmed?requestedAction:"WATCH",reason:String(o.reason||"")+(confirmed?"":" Revolut availability is not confirmed; verify the exact instrument in Revolut before treating this as actionable."),dataUsed:Array.isArray(o.dataUsed)?o.dataUsed.map(String):[]};
      });
    result.summary=String(result.summary||"");
    result.researchNotes=Array.isArray(result.researchNotes)?result.researchNotes.map(String):[];
    const candidateRows=input.candidates.filter(Boolean);
    const quoteCoverage=candidateRows.length ? candidateRows.filter(c=>Number.isFinite(Number(c?.price)) && Number(c.price)>0).length/candidateRows.length : 0;
    const evidenceCoverage=candidateRows.length ? candidateRows.filter(c=>{
      const r=c?.research||{};
      const isStock=c?.assetType==='Individual stock';
      return isStock ? Boolean(r?.fundamentals || (Array.isArray(r?.news)&&r.news.length)) : Boolean(r?.metadataAvailable);
    }).length/candidateRows.length : 0;
    const usableCoverage=Math.min(quoteCoverage,evidenceCoverage);
    result.dataQuality=usableCoverage>=0.9?'HIGH':usableCoverage>=0.65?'MEDIUM':'LOW';
    result.researchNotes=[...(Array.isArray(result.researchNotes)?result.researchNotes.map(String):[])];
    if(quoteCoverage<0.9) result.researchNotes.push(`Live quote coverage is ${Math.round(quoteCoverage*100)}% of candidates.`);
    if(evidenceCoverage<0.9) result.researchNotes.push(`Appropriate research evidence is available for ${Math.round(evidenceCoverage*100)}% of candidates.`);
    return send(res,200,result);
  } catch(e) {
    console.error("Opportunity research error:",e);
    return send(res,500,{error:e.message||"Internal server error."});
  }
};
