// Insu Lang — Vercel Serverless Function
// AI only explains an EXISTING rule-based Quick Check score.
// It never calculates, changes, or replaces the rule-based score.

const MODEL_CANDIDATES = [...new Set([
  process.env.GEMINI_MODEL,
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.8-flash"
].filter(Boolean))];

const MAX_BODY_BYTES = 12 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;

const buckets = globalThis.__insuLangAiBuckets || new Map();
globalThis.__insuLangAiBuckets = buckets;

const DOMAIN_KEYS = ["life", "ci", "medical", "accident"];
const DOMAIN_NAMES = {
  life: "人寿保障",
  ci: "重疾保障",
  medical: "医疗保障",
  accident: "意外保障"
};

const QUESTION_IDS = new Set(["why_score", "impact", "cash", "priority", "next"]);
const QUESTION_GUIDANCE = {
  why_score:
    "回答：为什么会得到这个评分？结合这次四项保障评分的高低解释，不重新计算。2至3句话。",
  impact:
    "回答：什么保障影响最大？先说明每个人的需求不一样，需要看风险保障比、家庭责任和目前短板，再结合本次评分指出较需要留意的项目。不要说某一种保障永远最重要。2至3句话。",
  cash:
    "回答：我有流动现金，为什么还是不够？说明现金缓冲与风险保障用途不同；现金缓冲这里只用于看重病发生时家庭能马上撑多久，不从人寿或重疾保障需求中扣除。2至3句话。",
  priority:
    "回答：我应该先看哪一项？根据本次四项评分相对较低的项目，建议先核对哪些保障，但不要替客户做投保决定，也不要推荐具体产品。2至3句话。",
  next:
    "回答：下一步我可以怎么做？建议核对现有保障、保单资料、Medical Card资料与家庭责任；需要更完整时再做 Full Review。不要推销产品。2至3句话。"
};

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return false;
  try { return new URL(origin).host === String(host); }
  catch { return false; }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0].trim().slice(0, 80);
}

function allowRequest(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const item = buckets.get(ip);
  if (!item || now - item.start > RATE_WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return true;
  }
  item.count += 1;
  if (buckets.size > 500) {
    for (const [k, v] of buckets) {
      if (now - v.start > RATE_WINDOW_MS) buckets.delete(k);
    }
  }
  return item.count <= RATE_MAX;
}

function isScore(v) {
  return Number.isFinite(v) && v >= 0 && v <= 100;
}

function sanitizeProfile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const overall = Number(raw.overall_score);
  if (!isScore(overall)) return null;

  const inputDomains = raw.domains;
  if (!inputDomains || typeof inputDomains !== "object" || Array.isArray(inputDomains)) return null;

  const domains = {};
  for (const key of DOMAIN_KEYS) {
    const d = inputDomains[key];
    if (!d || typeof d !== "object") return null;
    const score = Number(d.score);
    if (!isScore(score)) return null;
    domains[key] = { score: Math.round(score) };
  }

  const months = Number(raw.cash_buffer_months);
  if (!Number.isFinite(months) || months < 0 || months > 120) return null;

  const m = raw.medical;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;

  return {
    overall_score: Math.round(overall),
    domains,
    cash_buffer_months: Math.round(months * 10) / 10,
    medical: {
      has_card: Boolean(m.has_card),
      annual_below_reference: Boolean(m.annual_below_reference),
      room_below_reference: Boolean(m.room_below_reference)
    }
  };
}

function describeProfile(p) {
  const domainLines = DOMAIN_KEYS
    .map(k => `${DOMAIN_NAMES[k]}：${p.domains[k].score}/100`)
    .join("\n");

  const med = !p.medical.has_card
    ? "目前没有 Medical Card"
    : [
        p.medical.annual_below_reference
          ? "Annual Limit 低于 Quick Check 参考标准"
          : "Annual Limit 达到 Quick Check 参考标准",
        p.medical.room_below_reference
          ? "Room & Board 低于 Quick Check 参考标准"
          : "Room & Board 达到 Quick Check 参考标准"
      ].join("；");

  return [
    `整体评分：${p.overall_score}/100`,
    domainLines,
    `现金缓冲：约 ${p.cash_buffer_months} 个月家庭开销`,
    `医疗信号：${med}`
  ].join("\n");
}

function cleanAnswer(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*[-*#]+\s*/gm, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 520);
}

function safeError(status) {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401 || status === 403) return "API_KEY_REJECTED";
  if (status === 404) return "MODEL_NOT_AVAILABLE";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "GOOGLE_TEMPORARY_ERROR";
  return "AI_UNAVAILABLE";
}

async function callGemini(apiKey, profile, questionId, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const prompt = `你是 Insu Lang 的 AI ANALYSIS。你只负责解释已经由规则引擎算好的 Quick Check 评分。\n\n必须遵守：\n1. 不重新计算、不修改、不质疑任何分数。\n2. 不推荐具体保险产品、公司、保费或购买金额。\n3. 只根据匿名评分、现金缓冲和医疗信号解释，没有提供的资料不要猜。\n4. 不把现金缓冲当成人寿或重疾保障的替代品。\n5. 用简体中文，专业、清楚、简短，不制造恐惧，不用销售腔。\n6. 不声称某一种保障对所有人永远最重要。\n7. 如果提到下一步，只建议核对现有保障、保单资料或进行 Full Review，不替客户作投保决定。\n\n匿名 Quick Check 结果：\n${describeProfile(profile)}\n\n${QUESTION_GUIDANCE[questionId]}\n\n只输出直接答案，不要标题，不要列表，不要 JSON，不要 Markdown。`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 220
        }
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) {
      const err = new Error(`Gemini ${response.status}`);
      err.status = response.status;
      err.code = safeError(response.status);
      err.detail = raw.slice(0, 240);
      throw err;
    }

    let data;
    try { data = JSON.parse(raw); }
    catch {
      const err = new Error("Invalid Gemini response");
      err.code = "INVALID_RESPONSE";
      throw err;
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("");

    const answer = cleanAnswer(text);
    if (!answer) {
      const err = new Error("Empty Gemini response");
      err.code = "EMPTY_RESPONSE";
      throw err;
    }

    return { answer, model };
  } finally {
    clearTimeout(timer);
  }
}

async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  // Safe health check: confirms deployment/env without exposing the secret.
  if (req.method === "GET") {
    return send(res, 200, {
      ok: true,
      configured: Boolean(apiKey),
      models: MODEL_CANDIDATES
    });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!sameOrigin(req)) return send(res, 403, { error: "Forbidden", code: "ORIGIN_REJECTED" });
  if (!allowRequest(req)) return send(res, 429, { error: "Too many requests", code: "RATE_LIMITED" });

  const len = Number(req.headers["content-length"] || 0);
  if (len > MAX_BODY_BYTES) return send(res, 413, { error: "Request too large", code: "REQUEST_TOO_LARGE" });
  if (!apiKey) return send(res, 503, { error: "AI analysis is not configured", code: "KEY_NOT_CONFIGURED" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { return send(res, 400, { error: "Invalid JSON", code: "INVALID_JSON" }); }
  }

  const profile = sanitizeProfile(body?.profile);
  if (!profile) return send(res, 400, { error: "Invalid analysis profile", code: "INVALID_PROFILE" });

  const questionId = typeof body?.question === "string" ? body.question : "";
  if (!QUESTION_IDS.has(questionId)) {
    return send(res, 400, { error: "Invalid analysis question", code: "INVALID_QUESTION" });
  }

  let lastErr;
  for (const model of MODEL_CANDIDATES) {
    try {
      const result = await callGemini(apiKey, profile, questionId, model);
      return send(res, 200, { answer: result.answer });
    } catch (err) {
      lastErr = err;
      console.error("Insu Lang AI error:", model, err?.message || "unknown", err?.status || "", err?.code || "");
      // Only try the next model if the model itself is unavailable or temporarily fails.
      if (![404, 429, 500, 502, 503, 504].includes(err?.status)) break;
    }
  }

  if (lastErr?.name === "AbortError") {
    return send(res, 504, { error: "AI analysis timed out", code: "TIMEOUT" });
  }
  return send(res, 502, {
    error: "AI analysis is temporarily unavailable",
    code: lastErr?.code || safeError(lastErr?.status || 0)
  });
}

module.exports = handler;
