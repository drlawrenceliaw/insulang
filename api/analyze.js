// Insu Lang — Gemini API
// Security V2 + Gemini 3.8 Flash
// AI only explains the existing Quick Check result.
// It never recalculates the score.

const QUESTION_GUIDANCE = Object.freeze({
  why_score:
    "解释为什么会得到这个评分。结合四项保障分数的高低说明原因，不重新计算。回答 2–3 句话。",

  impact:
    "回答什么保障影响最大。先说明每个人的需求不同，要看风险保障比、家庭责任和当前短板，再结合本次评分说明。回答 2–3 句话。",

  cash:
    "解释为什么有流动现金仍不能完全替代保障。现金这里只代表重病发生时家庭可以马上撑多久，不从保障需求中扣除。回答 2–3 句话。",

  priority:
    "根据现有四项评分，说明客户可以先检视哪一项以及原因。不要推荐具体产品或保费。回答 2–3 句话。",

  next:
    "说明下一步可以怎么做。建议先核对现有保障、Medical Card 和家庭责任，需要更完整时再做 Full Review。回答 2–3 句话。"
});

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_OUTPUT_CHARS = 1800;
const GEMINI_TIMEOUT_MS = 20000;

function safeNumber(value, min = 0, max = 100) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function safeProfile(profile) {
  const domains = profile?.domains || {};

  return {
    overall_score: safeNumber(
      profile?.overall_score
    ),

    life_score: safeNumber(
      domains?.life?.score
    ),

    ci_score: safeNumber(
      domains?.ci?.score
    ),

    medical_score: safeNumber(
      domains?.medical?.score
    ),

    accident_score: safeNumber(
      domains?.accident?.score
    ),

    cash_buffer_months: safeNumber(
      profile?.cash_buffer_months,
      0,
      600
    ),

    medical: {
      has_card: Boolean(
        profile?.medical?.has_card
      ),

      annual_below_reference: Boolean(
        profile?.medical?.annual_below_reference
      ),

      room_below_reference: Boolean(
        profile?.medical?.room_below_reference
      )
    }
  };
}

function isValidRequest(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return false;
  }

  if (
    !body.profile ||
    typeof body.profile !== "object" ||
    Array.isArray(body.profile)
  ) {
    return false;
  }

  if (typeof body.question !== "string") {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(
    QUESTION_GUIDANCE,
    body.question
  );
}

function requestTooLarge(req) {
  const contentLength = Number(
    req.headers?.["content-length"] || 0
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return true;
  }

  try {
    const size = Buffer.byteLength(
      JSON.stringify(req.body || {}),
      "utf8"
    );

    return size > MAX_REQUEST_BYTES;
  } catch {
    return true;
  }
}

export default async function handler(req, res) {

  // Do not cache responses containing
  // Quick Check scoring information.
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "METHOD_NOT_ALLOWED"
    });
  }

  const contentType =
    req.headers?.["content-type"] || "";

  if (
    !contentType
      .toLowerCase()
      .includes("application/json")
  ) {
    return res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE"
    });
  }

  if (requestTooLarge(req)) {
    return res.status(413).json({
      error: "REQUEST_TOO_LARGE"
    });
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "AI_NOT_CONFIGURED"
    });
  }

  if (!isValidRequest(req.body)) {
    return res.status(400).json({
      error: "INVALID_REQUEST"
    });
  }

  const {
    profile,
    question
  } = req.body;

  // Only sanitized numbers and booleans
  // are allowed into the AI prompt.
  const safe = safeProfile(profile);

  const prompt = `你是 Insu Lang 的 AI ANALYSIS。

你的任务只有一个：
解释已经由 Quick Check 固定规则算出的评分。

必须遵守：
- 不重新计算或修改任何分数。
- 不推荐具体保险产品、公司、保费或购买金额。
- 不猜测没有提供的客户资料。
- 不制造恐惧，不使用销售话术。
- 用简体中文，专业、清楚、简短。

匿名 Quick Check 结果：
${JSON.stringify(safe)}

问题：
${QUESTION_GUIDANCE[question]}

只输出答案正文，不要标题，不要 JSON，不要 Markdown。`;

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    GEMINI_TIMEOUT_MS
  );

  try {

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            apiKey
        },

        signal: controller.signal,

        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],

          generationConfig: {

            maxOutputTokens: 1000,

            thinkingConfig: {
              thinkingLevel: "low"
            }
          }
        })
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {

      const detail =
        await response.text();

      console.error(
        "Gemini API error:",
        response.status,
        detail.slice(0, 1200)
      );

      return res.status(502).json({
        error: "AI_PROVIDER_ERROR",
        status: response.status
      });
    }

    const data =
      await response.json();

    const text = (
      data?.candidates?.[0]
        ?.content?.parts || []
    )
      .map(part =>
        typeof part?.text === "string"
          ? part.text
          : ""
      )
      .join("")
      .trim();

    if (!text) {

      console.error(
        "Gemini returned empty response"
      );

      return res.status(502).json({
        error: "EMPTY_AI_RESPONSE"
      });
    }

    const answer =
      text.slice(
        0,
        MAX_OUTPUT_CHARS
      );

    return res.status(200).json({
      answer
    });

  } catch (error) {

    clearTimeout(timeout);

    if (
      error?.name === "AbortError"
    ) {

      console.error(
        "Gemini request timeout"
      );

      return res.status(504).json({
        error: "AI_TIMEOUT"
      });
    }

    console.error(
      "AI server error:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return res.status(500).json({
      error: "AI_ANALYSIS_FAILED"
    });
  }
}
