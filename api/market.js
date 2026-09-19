const ALLOWED_ORIGIN = "https://gabrielabela2003.github.io";
function corsHeaders(){return {"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json"};}
function send(res,status,body){Object.entries(corsHeaders()).forEach(([k,v])=>res.setHeader(k,v));return res.status(status).json(body);}

async function yahooQuote(symbol){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`;
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok) throw new Error(`Yahoo ${symbol} ${r.status}`);
  const d=await r.json();
  const result=d?.chart?.result?.[0];
  const meta=result?.meta||{};
  const price=Number(meta.regularMarketPrice ?? meta.previousClose);
  if(!Number.isFinite(price)||price<=0) throw new Error(`No price for ${symbol}`);
  let prev=Number(meta.previousClose);
  if(!Number.isFinite(prev)||prev<=0){
    const closes=result?.indicators?.quote?.[0]?.close||[];
    const valid=closes.map(Number).filter(v=>Number.isFinite(v)&&v>0);
    if(valid.length>=2) prev=valid[valid.length-2];
  }
  return {price,prevClose:Number.isFinite(prev)&&prev>0?prev:null,currency:meta.currency||null,exchangeName:meta.fullExchangeName||meta.exchangeName||null,source:'Yahoo Finance'};
}

module.exports=async(req,res)=>{
  if(req.method==='OPTIONS') return send(res,204,{});
  if(req.method!=='POST') return send(res,405,{error:'POST only'});
  try{
    const symbols=Array.isArray(req.body?.symbols)?req.body.symbols.map(String).filter(Boolean).slice(0,40):[];
    if(!symbols.length) return send(res,400,{error:'symbols must be a non-empty array'});
    const quotes={};
    for(const symbol of symbols){
      try{quotes[symbol]=await yahooQuote(symbol);}catch(e){quotes[symbol]={error:e.message};}
    }
    return send(res,200,{quotes,source:'Yahoo Finance chart endpoint',note:'Quotes may be delayed; use the timestamp and broker screen for execution pricing.'});
  }catch(e){return send(res,500,{error:e.message||'Market data failed'});}
};
