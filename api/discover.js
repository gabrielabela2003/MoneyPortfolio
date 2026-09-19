const ALLOWED_ORIGIN = "https://gabrielabela2003.github.io";
function corsHeaders(){return {"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json"};}
function send(res,status,body){Object.entries(corsHeaders()).forEach(([k,v])=>res.setHeader(k,v));return res.status(status).json(body);}
function extractText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim()) return data.output_text.trim();
  const chunks=[];
  for(const item of (data?.output||[])) for(const content of (item?.content||[])) if(typeof content?.text==='string') chunks.push(content.text);
  return chunks.join('\n').trim();
}
const SCHEMA={type:'object',additionalProperties:false,properties:{
  summary:{type:'string'},
  candidates:{type:'array',items:{type:'object',additionalProperties:false,properties:{
    ticker:{type:'string'},name:{type:'string'},assetType:{type:'string',enum:['Individual stock','Diversified ETF','Sector ETF','Bond ETF','Property ETF','Commodity ETP','Other ETP']},sector:{type:'string'},exposure:{type:'string'},marketSymbols:{type:'array',items:{type:'string'}},whyItWasDiscovered:{type:'string'}
  },required:['ticker','name','assetType','sector','exposure','marketSymbols','whyItWasDiscovered']}},
  researchNotes:{type:'array',items:{type:'string'}}
},required:['summary','candidates','researchNotes']};
module.exports=async(req,res)=>{
  if(req.method==='OPTIONS') return send(res,204,{});
  if(req.method!=='POST') return send(res,405,{error:'POST only'});
  if(!process.env.OPENAI_API_KEY) return send(res,500,{error:'OPENAI_API_KEY is not configured in Vercel.'});
  try{
    const input=req.body||{};
    if(!Array.isArray(input.holdings)) return send(res,400,{error:'Invalid portfolio data.'});
    const prompt=`You are Ledger's dynamic opportunity discovery engine. Your job is to discover a broader research universe of standard, investable stocks and ETFs that could complement the supplied portfolio.

Use web search to ground the discovery in current public information. This is discovery, not an investment recommendation and not a Revolut availability check.

IMPORTANT:
- Do NOT claim any candidate is available in Revolut. Account-specific availability must be checked by the user in the Revolut Invest app.
- Return only real, currently listed instruments with a clear ticker and at least one plausible exchange-qualified market symbol.
- Prefer liquid, mainstream, non-leveraged, non-inverse instruments that a retail investor could reasonably research.
- Exclude crypto, leveraged/inverse ETPs, OTC/penny stocks, warrants, options, futures and highly exotic products.
- Include individual companies as well as diversified/sector ETFs when they could address portfolio gaps.
- Avoid simply repeating the user's existing holdings unless there is a materially different instrument or exposure.
- Consider concentration, sector overlap, geography, market-cap exposure, and asset-class diversification.
- Discover 8-12 candidates, with a mix when justified by the portfolio.
- Amazon, Alphabet, Meta, AMD, JPMorgan, Visa, Mastercard and similar companies are eligible examples, but do not include them merely because they were named; include them only if the portfolio/context supports their research relevance.
- Do not invent financial metrics or make performance predictions.
- marketSymbols should use symbols suitable for quote lookup where possible, e.g. AMZN for Amazon or VWCE.DE for a German-listed ETF. For US stocks, the plain US ticker is normally sufficient.

The output will be placed into Ledger's Revolut verification queue. Unconfirmed discoveries will NEVER be sent to the opportunity-scoring AI until the user explicitly confirms the exact instrument is available in Revolut.

Return only the structured output.`;
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.6',tools:[{type:'web_search'}],input:[
      {role:'system',content:[{type:'input_text',text:prompt}]},
      {role:'user',content:[{type:'input_text',text:JSON.stringify(input)}]}
    ],text:{format:{type:'json_schema',name:'ledger_dynamic_discovery',strict:true,schema:SCHEMA}},max_output_tokens:5000})});
    const data=await response.json();
    if(!response.ok) return send(res,response.status,{error:data?.error?.message||'Dynamic discovery failed.'});
    const result=JSON.parse(extractText(data));
    const existing=new Set((input.existingTickers||[]).map(x=>String(x).toUpperCase()));
    const seen=new Set();
    result.candidates=(Array.isArray(result.candidates)?result.candidates:[]).map(c=>({
      ticker:String(c.ticker||'').toUpperCase().trim(),name:String(c.name||'').trim(),assetType:String(c.assetType||'Other ETP'),sector:String(c.sector||'Unclassified').trim(),exposure:String(c.exposure||'').trim(),marketSymbols:[...new Set((Array.isArray(c.marketSymbols)?c.marketSymbols:[]).map(x=>String(x).toUpperCase().trim()).filter(Boolean))],whyItWasDiscovered:String(c.whyItWasDiscovered||'').trim()
    })).filter(c=>c.ticker&&c.name&&c.marketSymbols.length&&!existing.has(c.ticker)&&!seen.has(c.ticker)&&(seen.add(c.ticker),true)).slice(0,12);
    result.summary=String(result.summary||'');
    result.researchNotes=Array.isArray(result.researchNotes)?result.researchNotes.map(String):[];
    result.researchNotes.push('Revolut availability was not inferred. Every discovered instrument must be checked in the Revolut Invest app before it can enter Ledger\'s opportunity scan.');
    return send(res,200,result);
  }catch(e){console.error('Dynamic discovery error:',e);return send(res,500,{error:e.message||'Internal server error.'});}
};
