// Vercel Serverless Function — AI 只解释评分，不参与计算。
// 在 Vercel Settings -> Environment Variables 设置 GEMINI_API_KEY 即可启用。
// 可选：GEMINI_MODEL。默认使用 gemini-3.1-flash-lite，适合短解释与免费层测试。
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({error:"AI_NOT_CONFIGURED"});
  const body = req.body || {};
  const profile = body.profile;
  if (!profile || typeof profile !== "object") return res.status(400).json({error:"Missing profile"});
  const safe = {
    overall_score: Number(profile.overall_score || 0),
    domains: Array.isArray(profile.domains) ? profile.domains.slice(0, 6).map(x=>({
      name:String(x.name||"").slice(0,40), score:x.score===null?null:Number(x.score||0), status:String(x.status||"").slice(0,40), manual:Boolean(x.manual)
    })) : [],
    cash_buffer_status: String(profile.cash_buffer_status||"").slice(0,40),
    reasons: Array.isArray(profile.reasons) ? profile.reasons.slice(0,5).map(x=>String(x).slice(0,180)) : []
  };
  const prompt = `你是 Insu Lang 的报告解释助手。核心评分已经由 Dr. Lawrence Liaw 设定的固定规则算好，你绝对不能重新计算、修改分数、推翻规则，也不能推荐具体保险产品或保费。\n\n请根据以下匿名结果，用简体中文解释为什么会得到这样的评分。语气专业、清楚、短，不说教，不夸张推销。\n\n匿名结果：${JSON.stringify(safe)}\n\n只输出 JSON：{"overview":"1句话整体观察","explanation":"2-4句话解释主要 gap 和相对做得好的地方","next_step":"1句话告诉客户下一步先确认什么；如果有 manual=true，则建议 Full Review"}`;
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method:"POST",
      headers:{"Content-Type":"application/json","x-goog-api-key":process.env.GEMINI_API_KEY},
      body:JSON.stringify({
        contents:[{role:"user",parts:[{text:prompt}]}],
        generationConfig:{responseMimeType:"application/json",maxOutputTokens:500}
      })
    });
    if (!r.ok) { const t=await r.text(); console.error("Gemini error",r.status,t); return res.status(502).json({error:"AI provider error"}); }
    const data=await r.json();
    const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    let parsed; try{parsed=JSON.parse(text.replace(/```json|```/g,"").trim())}catch(e){return res.status(502).json({error:"Bad AI output"})}
    return res.status(200).json(parsed);
  } catch (e) { console.error(e); return res.status(500).json({error:"AI analysis failed"}); }
}
