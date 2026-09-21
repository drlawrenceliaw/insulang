// Insu Lang — Gemini API
// Security V2 + Prompt V3
// Stable model: Gemini 3.1 Flash Lite
// AI only explains rule-engine results. It never recalculates scores.

const QUESTION_GUIDANCE = Object.freeze({
  why_score: `
回答：为什么会得到这个评分？

重点：解释“分数怎样算出来”，不是评价哪里好或不好。
- 先说明整体评分是由可计算的人寿、重疾、医疗、意外评分取平均后四舍五入得到。
- 人寿、重疾、意外的分数，都是规则引擎根据“现有保障 ÷ 参考需求”算好，再限制最高100分。
- 医疗保障由 Annual Limit 最多80分 + Room & Board 最多20分组成。
- 只使用已经提供的 existing、reference_need、score、annual_points、room_points，不要自己重新计算。
- 可以挑1至2个最能解释结果的例子，不要把全部公式写成报告。
- 不要写“哪里需要提升”“哪里比较差”，这题重点是解释计算方式。
`,

  impact: `
回答：我现在应该先看哪一项保障？

重点：直接指出目前最低或最明显的保障Gap，并把“参考值”和“实际值”讲清楚。
- 不要主动提 Full Review。
- 如果医疗保障最低：
  - 有 Medical Card，就写实际 Annual Limit 和 Room & Board。
  - 同时写这次 Quick Check 的参考值：Annual Limit ≥ RM1百万，Room & Board ≥ RM300/天。
  - 没有 Medical Card，才可以说目前没有 Medical Card。
- 如果人寿、重疾或意外最低，就比较现有保障与已经算好的参考需求。
- 如果两项同分最低，可以一起讲，不要硬选一个。
- 可以引用评分，格式“（32分）”。
`,

  cash: `
回答：我有流动现金，为什么还是有保障Gap？

重点：解释“自己的现金”和“风险转移”是两个不同概念。
- 不要反驳客户，不要说教，也不要调侃。
- 可以自然表达：现金是自己的钱，风险发生时用多少就少多少；保险是用相对确定的保费，把一部分较大的不确定支出转给保险公司承担。
- 不要使用“RM1赔RM100”这种固定比例，因为不同保障没有统一赔付比例。
- 说明 Quick Check 的保障Gap是在看现有保障跟参考值之间的差距，不是用现金余额来抵消保障需求。
- 讲清楚就停。
`,

  priority: `
回答：这个结果代表我一定要加保吗？

重点：简单、直接。
- 第一行必须是“**不一定。**”
- 说明 Quick Check 只是帮用户找出目前的保障Gap，让用户马上知道哪里不足，也更容易理解自己的保障。
- 不要再说“还要结合现有保单和家庭责任”，因为这些资料已经用于 Quick Check。
- 不需要列评分，除非真的有帮助。
- 最后可以说“要不要调整，由你自己决定。”
- 不推荐产品、公司、保费或购买金额。
`,

  next: `
回答：接下来我可以怎样做？

重点：先整体整理四项评分，再自然带到 Dr. Lawrence 的 Full Review。
- 第一段给一个整体结论。
- 第二段可以用一行显示四项评分：人寿 xx分｜重疾 xx分｜医疗 xx分｜意外 xx分。
- 第三段指出目前比较明显的保障Gap在哪里。
- 如果想进一步了解这些Gap该怎样调整，可以由 Dr. Lawrence 亲自做 Full Review。
- 不要叫客户重新核对、重新看或再检视一次。
- Full Review 是 Dr. Lawrence 亲自做，不是 AI 做。
`
});

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_OUTPUT_CHARS = 1600;
const GEMINI_TIMEOUT_MS = 20000;
const MAX_AMOUNT = 10000000;

function safeNumber(value, min = 0, max = 100) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, n)
  );
}

function safeOptionalAmount(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  return Math.min(
    MAX_AMOUNT,
    Math.max(0, n)
  );
}

function safeDomain(domain) {
  return {
    score:
      safeNumber(domain?.score),

    manual:
      Boolean(domain?.manual),

    existing:
      safeOptionalAmount(
        domain?.existing
      ),

    reference_need:
      safeOptionalAmount(
        domain?.reference_need
      )
  };
}

function safeProfile(profile) {
  const domains =
    profile?.domains || {};

  const medical =
    profile?.medical || {};

  return {
    overall_score:
      safeNumber(
        profile?.overall_score
      ),

    domains: {
      life:
        safeDomain(
          domains?.life
        ),

      ci:
        safeDomain(
          domains?.ci
        ),

      medical:
        safeDomain(
          domains?.medical
        ),

      accident:
        safeDomain(
          domains?.accident
        )
    },

    cash_buffer_months:
      safeNumber(
        profile?.cash_buffer_months,
        0,
        120
      ),

    medical: {
      has_card:
        Boolean(
          medical?.has_card
        ),

      annual_limit:
        safeOptionalAmount(
          medical?.annual_limit
        ),

      annual_reference:
        1000000,

      annual_points:
        safeNumber(
          medical?.annual_points,
          0,
          80
        ),

      annual_points_max:
        80,

      room_and_board:
        safeNumber(
          medical?.room_and_board,
          0,
          5000
        ),

      room_reference:
        300,

      room_points:
        safeNumber(
          medical?.room_points,
          0,
          20
        ),

      room_points_max:
        20,

      score:
        safeNumber(
          medical?.score
        ),

      annual_below_reference:
        Boolean(
          medical?.annual_below_reference
        ),

      room_below_reference:
        Boolean(
          medical?.room_below_reference
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
    return Buffer.byteLength(
      JSON.stringify(
        req.body || {}
      ),
      "utf8"
    ) > MAX_REQUEST_BYTES;

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

你的工作，是把已经由 Quick Check 规则引擎算好的结果，用自然的马来西亚华人中文解释清楚。

你不是负责重新计算。
你不是负责卖保险。
你不是负责做 Full Review。

【Quick Check 已固定的计算逻辑】

- 整体评分：把所有可计算的保障评分取平均后四舍五入。
- 人寿保障：规则引擎已经根据“现有保障 ÷ 参考需求 × 100”算好，最高100分。
- 重疾保障：规则引擎已经根据“现有保障 ÷ 参考需求 × 100”算好，最高100分。
- 意外保障：规则引擎已经根据“现有保障 ÷ 参考需求 × 100”算好，最高100分。
- 医疗保障：Annual Limit 最多80分，Room & Board 最多20分，两项分数相加得到医疗评分。

这些分数都已经算好。
只负责解释，不要重新计算、修改或推翻。

【口吻】

- 像一个正常的马来西亚华人保险顾问在 WhatsApp 跟客户解释。
- 用“你”，不要用“您”。
- 直接、有礼貌、有根据，不绕。
- 不要写成报告、论文、银行文件或销售文案。
- 不要使用太AI、太书面的表达。
- 可以自然保留 Medical Card、Annual Limit、Room & Board、Full Review。
- 统一写“保障Gap”，中间不要空格。

避免这些词：
“提升空间”
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

1. 第一行一定直接给结论，并用 Markdown Bold：
**结论。**

2. 第一行后空一行。

3. 默认2至3个短段落，每段只写一句话。

4. 两句话已经讲清楚就结束，不要为了凑3段而重复。

5. 如果真的有3个以上独立重点，才用 point form，最多3点。

6. 每个回答最多1至2个 Bold。
第一句结论一定 Bold，第二个 Bold 只留给真正重要的保障Gap或重点。

7. 中文标点统一使用“，”和“。”。

【金额和评分】

- 只使用下面提供的数字。
- 不自己重新计算。
- 有需要时才引用评分。
- 分数格式写“（32分）”。
- 不要把四项评分每题都重复一遍；只有第5题可以完整列四项评分。
- 金额用马来西亚习惯写法，例如 RM50k、RM300k、RM1百万。

【Medical Card】

- has_card = false，才可以说目前没有 Medical Card。
- has_card = true，绝对不要说“没有医疗保障”。
- 如果医疗是重点，可以直接比较实际 Annual Limit / Room & Board 和参考值。
- Annual Limit 参考值固定为 ≥ RM1百万。
- Room & Board 参考值固定为 ≥ RM300/天。
- 医疗评分的 annual_points 和 room_points 已经由规则引擎算好，直接解释，不要重算。

【现金】

- 不要否定现金的重要性。
- 不要用“现金够也不代表保障够”这种像在反驳客户的句子。
- 可以解释：现金是自己的钱，风险发生时用多少就少多少；保险是用相对确定的保费，把一部分较大的不确定支出转给保险公司承担。
- 不要写“RM1赔RM100”这种固定比例。

【必须遵守】

- 不重新计算任何评分。
- 不修改任何评分。
- 不自行推算新的保障金额、保障Gap金额或保费。
- 不推荐具体保险产品或保险公司。
- 不猜测没有提供的客户资料。
- 不制造焦虑，不使用恐吓语气。
- 不要反驳客户。
- 不要讲大道理。
- 第1至第4题不要主动提 Full Review。
- 只有第5题可以自然提到由 Dr. Lawrence 亲自做 Full Review。

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
      error?.name === "AbortError"
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
