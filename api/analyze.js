// Insu Lang — Gemini API
// Security V2 + Prompt V2
// Stable model: Gemini 3.1 Flash Lite
// AI only explains the existing Quick Check result.
// It never recalculates the score.

const QUESTION_GUIDANCE = Object.freeze({
  why_score: `
回答：为什么会得到这个评分？

要求：
- 先直接说明整体评分主要受到哪些保障影响。
- 只引用最关键的1至2个评分，不要把四项评分全部念一遍。
- 如果某项评分明显较低，可以写“医疗保障评分比较低（32分）”这种格式。
- 最后可以直接指出目前比较明显的保障Gap在哪里。
- 不要说“还要再看”“还要再确认”之类，因为 Quick Check 已经完成分析。
`,

  impact: `
回答：我现在应该先看哪一项保障？

要求：
- 直接指出目前最应该先看的保障。
- 主要根据最低评分判断。
- 如果两项评分一样低，可以一起讲，不要硬选一项。
- 需要时引用评分，格式用“（32分）”。
- 如果医疗保障较低，要根据资料判断：
  - 没有 Medical Card，才可以说目前没有 Medical Card。
  - 有 Medical Card，但 Annual Limit 较低，就讲 Annual Limit。
  - 有 Medical Card，但 Room & Board 较低，就讲 Room & Board。
  - 两项都低，可以一起讲。
- 不要说“没有医疗保障”，除非资料真的显示没有 Medical Card。
`,

  cash: `
回答：我有流动现金，为什么还是有保障Gap？

要求：
- 不要反驳客户，也不要用教育或调侃的语气。
- 直接解释流动现金和保险保障看的是两个不同部分。
- 流动现金主要反映发生重病时，手上的资金可以支撑多久。
- 保障Gap反映现有保障跟这次 Quick Check 参考值之间的差距。
- 讲清楚就停，不需要再加“现金多也不代表保障够”这种句子。
`,

  priority: `
回答：这个结果代表我一定要加保吗？

要求：
- 第一行直接回答“不一定。”
- 说明 Quick Check 是帮用户找出目前的保障Gap。
- 有保障Gap，不代表一定要马上加保。
- 不要再说“还要结合现有保单和家庭责任”，因为这些资料已经用于 Quick Check。
- 不推荐任何产品、公司、保费或购买金额。
`,

  next: `
回答：接下来我可以怎样做？

要求：
- 不要叫客户重新核对或重新看现有保障，因为 Quick Check 已经分析过。
- 可以说明这次结果是一个方向。
- Quick Check 已经整理出目前比较明显的保障Gap。
- 如果用户想进一步了解这些Gap该怎样调整，可以由 Dr. Lawrence 做 Full Review。
- Full Review 是由 Dr. Lawrence 亲自做，不是 AI 做。
`
});

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_OUTPUT_CHARS = 1600;
const GEMINI_TIMEOUT_MS = 20000;

function safeNumber(value, min = 0, max = 100) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, number)
  );
}

function safeProfile(profile) {
  const domains = profile?.domains || {};

  return {
    overall_score:
      safeNumber(profile?.overall_score),

    life_score:
      safeNumber(domains?.life?.score),

    ci_score:
      safeNumber(domains?.ci?.score),

    medical_score:
      safeNumber(domains?.medical?.score),

    accident_score:
      safeNumber(domains?.accident?.score),

    cash_buffer_months:
      safeNumber(
        profile?.cash_buffer_months,
        0,
        600
      ),

    medical: {
      has_card:
        Boolean(
          profile?.medical?.has_card
        ),

      annual_below_reference:
        Boolean(
          profile?.medical
            ?.annual_below_reference
        ),

      room_below_reference:
        Boolean(
          profile?.medical
            ?.room_below_reference
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

  if (
    typeof body.question !== "string"
  ) {
    return false;
  }

  return Object.prototype
    .hasOwnProperty.call(
      QUESTION_GUIDANCE,
      body.question
    );
}

function requestTooLarge(req) {
  const contentLength =
    Number(
      req.headers?.["content-length"] ||
      0
    );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return true;
  }

  try {
    const size =
      Buffer.byteLength(
        JSON.stringify(
          req.body || {}
        ),
        "utf8"
      );

    return (
      size > MAX_REQUEST_BYTES
    );

  } catch {
    return true;
  }
}

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  if (req.method !== "POST") {

    res.setHeader(
      "Allow",
      "POST"
    );

    return res
      .status(405)
      .json({
        error:
          "METHOD_NOT_ALLOWED"
      });
  }

  const contentType =
    req.headers?.["content-type"] ||
    "";

  if (
    !contentType
      .toLowerCase()
      .includes(
        "application/json"
      )
  ) {

    return res
      .status(415)
      .json({
        error:
          "UNSUPPORTED_MEDIA_TYPE"
      });
  }

  if (requestTooLarge(req)) {

    return res
      .status(413)
      .json({
        error:
          "REQUEST_TOO_LARGE"
      });
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {

    return res
      .status(503)
      .json({
        error:
          "AI_NOT_CONFIGURED"
      });
  }

  if (!isValidRequest(req.body)) {

    return res
      .status(400)
      .json({
        error:
          "INVALID_REQUEST"
      });
  }

  const {
    profile,
    question
  } = req.body;

  const safe =
    safeProfile(profile);

  const prompt = `你是 Insu Lang 的 AI ANALYSIS。

你的工作，是把已经由 Quick Check 算好的结果，用一个正常马来西亚华人保险顾问会使用的中文解释清楚。

你不是负责重新计算。
你不是负责卖保险。
你不是负责做 Full Review。

【口吻】

- 用自然的马来西亚华人中文。
- 用“你”，不要用“您”。
- 直接，有礼貌，有根据，不绕。
- 不要写成报告、论文、银行文件或销售文案。
- 不要使用太中国式或太AI的表达。
- 可以自然保留 Medical Card、Annual Limit、Room & Board、Full Review 等英文保险用语。

避免这些表达：
“建议优先检视”
“风险暴露”
“优化方案”
“财务支持”
“参考标准”
“整体规划”
“现阶段”
“项目”

优先使用：
“现在”
“保障”
“应该先看”
“比较明显”
“参考值”
“保障Gap”
“该怎样调整”

【格式】

1. 第一行一定直接给结论，而且用 Markdown Bold：
**结论。**

2. 第一行后面空一行。

3. 默认使用2至3个短段落。
每一个段落只写一句话。

4. 如果两句话已经讲清楚，就结束。
不要为了凑3段而重复。

5. 如果真的有3个不同重点以上，才改用 point form：
**结论。**

- 重点一。
- 重点二。
- 重点三。

最多3点。

6. 不要同时写一大段再加 point form。

7. Bold 要克制。
每个回答最多1至2个 Bold。
第一句结论一定 Bold。
第二个 Bold 只用在真正重要的保障Gap或重点。

8. 中文标点统一使用：
“，”
“。”
不要使用英文逗号。

【评分】

- 只有在评分对解释有帮助时才引用。
- 不要把四项评分全部重复。
- 分数格式统一写成：
“（32分）”
- 可以写：
“医疗保障评分比较低（32分）”
- 不要写：
“医疗保障当前评分为32分”

- 如果最低两项评分一样，可以一起讲。
不要为了选一个而硬选一个。

- 如果某项达到100分，只能说：
“目前相对完整”
不要说：
“完全没有风险”
“完全足够”
“以后都不用管”

- 如果所有保障都相对完整，不要硬找问题。
直接说目前没有特别明显的保障Gap。

【Medical Card】

医疗保障评分低时，必须根据提供的资料解释。

如果 has_card = false：
可以说目前没有 Medical Card。

如果 has_card = true：
绝对不要说“没有医疗保障”。

如果 annual_below_reference = true：
可以说 Annual Limit 低于这次 Quick Check 的参考值。

如果 room_below_reference = true：
可以说 Room & Board 低于这次 Quick Check 的参考值。

如果两个都是 true：
可以一起讲。

【必须遵守】

- 不重新计算任何评分。
- 不修改任何评分。
- 不自行推算新的保障金额。
- 不自行推算新的保障Gap金额。
- 不推算保费。
- 不推荐具体保险产品。
- 不推荐保险公司。
- 不猜测没有提供的客户资料。
- 不制造焦虑。
- 不使用恐吓语气。
- 不要把某一种保障说成所有人都绝对最重要。
- 不要反驳客户。
- 不要讲大道理。
- 不要重复 Quick Check 已经完成的动作。
- 不要叫客户“重新核对”“重新看”“再检视一次”。

第1至第4题，不要主动提 Full Review。

只有第5题，可以自然提到：
由 Dr. Lawrence 亲自做 Full Review。

【匿名 Quick Check 结果】

${JSON.stringify(safe)}

【本次问题】

${QUESTION_GUIDANCE[question]}

只输出最后给客户看的答案。
不要输出分析过程。
不要输出标题。
不要输出 JSON。`;

  const model =
    "gemini-3.1-flash-lite";

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      GEMINI_TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey
          },

          signal:
            controller.signal,

          body:
            JSON.stringify({
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
                temperature: 0.1,
                maxOutputTokens: 500
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
        detail.slice(
          0,
          1200
        )
      );

      return res
        .status(502)
        .json({
          error:
            "AI_PROVIDER_ERROR",

          status:
            response.status
        });
    }

    const data =
      await response.json();

    const text =
      (
        data
          ?.candidates?.[0]
          ?.content?.parts ||
        []
      )
        .map(
          part =>
            typeof part?.text ===
            "string"
              ? part.text
              : ""
        )
        .join("")
        .trim();

    if (!text) {

      console.error(
        "Gemini returned empty response"
      );

      return res
        .status(502)
        .json({
          error:
            "EMPTY_AI_RESPONSE"
        });
    }

    const answer =
      text.slice(
        0,
        MAX_OUTPUT_CHARS
      );

    return res
      .status(200)
      .json({
        answer
      });

  } catch (error) {

    clearTimeout(timeout);

    if (
      error?.name ===
      "AbortError"
    ) {

      console.error(
        "Gemini request timeout"
      );

      return res
        .status(504)
        .json({
          error:
            "AI_TIMEOUT"
        });
    }

    console.error(
      "AI server error:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return res
      .status(500)
      .json({
        error:
          "AI_ANALYSIS_FAILED"
      });
  }
}
