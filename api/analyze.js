// Insu Lang — simple Gemini endpoint
// Reverted to the same simple Vercel/Gemini pattern that worked before.
// AI only explains the existing Quick Check score. It never recalculates it.

const QUESTION_GUIDANCE = {
  why_score: "解释为什么会得到这个评分。结合四项保障分数的高低说明原因，不重新计算。回答 2–3 句话。",
  impact: "回答什么保障影响最大。先说明每个人的需求不同，要看风险保障比、家庭责任和当前短板，再结合本次评分说明。回答 2–3 句话。",
  cash: "解释为什么有流动现金仍不能完全替代保障。现金这里只代表重病发生时家庭可以马上撑多久，不从保障需求中扣除。回答 2–3 句话。",
  priority: "根据现有四项评分，说明客户可以先检视哪一项以及原因。不要推荐具体产品或保费。回答 2–3 句话。",
  next: "说明下一步可以怎么做。建议先核对现有保障、Medical Card 和家庭责任，需要更完整时再做 Full Review。回答 2–3 句话。"
};

function safeProfile(profile) {
  const domains = profile?.domains || {};
  return {
    overall_score: Number(profile?.overall_score || 0),
    life_score: Number(domains?.life?.score || 0),
    ci_score: Number(domains?.ci?.score || 0),
    medical_score: Number(domains?.medical?.score || 0),
    accident_score: Number(domains?.accident?.score || 0),
    cash_buffer_months: Number(profile?.cash_buffer_months || 0),
    medical: {
      has_card: Boolean(profile?.medical?.has_card),
      annual_below_reference: Boolean(profile?.medical?.annual_below_reference),
      room_below_reference: Boolean(profile?.medical?.room_below_reference)
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "AI_NOT_CONFIGURED" });
  }

  const { profile, question } = req.body || {};
  if (!profile || !QUESTION_GUIDANCE[question]) {
    return res.status(400).json({ error: "INVALID_REQUEST" });
  }

  const safe = safeProfile(profile);
  const prompt = `你是 Insu Lang 的 AI ANALYSIS。\n\n你的任务只有一个：解释已经由 Quick Check 固定规则算出的评分。\n\n必须遵守：\n- 不重新计算或修改任何分数。\n- 不推荐具体保险产品、公司、保费或购买金额。\n- 不猜测没有提供的客户资料。\n- 不制造恐惧，不使用销售话术。\n- 用简体中文，专业、清楚、简短。\n\n匿名 Quick Check 结果：\n${JSON.stringify(safe)}\n\n问题：${QUESTION_GUIDANCE[question]}\n\n只输出答案正文，不要标题，不要 JSON，不要 Markdown。`;

  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1000
          }
        })
      }
    );

    if (!r.ok) {
      const detail = await r.text();
      console.error("Gemini API error:", r.status, detail);
      return res.status(502).json({
        error: "AI_PROVIDER_ERROR",
        status: r.status
      });
    }

    const data = await r.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => p?.text || "")
      .join("")
      .trim();

    if (!text) {
      console.error("Gemini returned empty text:", JSON.stringify(data).slice(0, 1000));
      return res.status(502).json({ error: "EMPTY_AI_RESPONSE" });
    }

    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("AI server error:", err);
    return res.status(500).json({ error: "AI_ANALYSIS_FAILED" });
  }
}
