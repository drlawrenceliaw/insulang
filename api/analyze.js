// Insu Lang — Gemini API
// Security V2 + Prompt V4
// Model: Gemini 3.1 Flash Lite
// AI only explains results already calculated by Quick Check.

const QUESTION_GUIDANCE = Object.freeze({
  why_score: `
回答：为什么会得到这个评分？

这题的重点是解释“评分怎样算出来”，不是分析哪里好或哪里不好。

回答逻辑：

第一句可以类似：
“你的整体评分（57分）是人寿，重疾，医疗和意外评分的平均值。”

必须使用中文逗号“，”。

接着解释：
- 人寿，重疾和意外评分，是根据“现有保障金额 / 预期值”来计算，最高100分。
- 可以带出实际评分，例如：
“人寿（47分），重疾（94分）和意外（6分）的分数，是按照现有保障金额 / 预期值来计算的，最高100分。”
- 不要使用“参考需求”，统一使用“预期值”。

医疗保障要另外解释：
- 医疗评分由 Annual Limit 得分 + Room & Board 得分组成。
- Annual Limit 最多80分。
- Room & Board 最多20分。
- annual_points 和 room_points 都已经由 Quick Check 算好。
- 直接解释已经算好的分数，不要重新计算。

例如：
“医疗保障（80分）是 Annual Limit 的得分（60分）和 Room & Board 的得分（20分）加起来得到的。”

这题不要讲：
- 哪项保障不足。
- 哪项应该优先看。
- 哪项有提升空间。
- Full Review。
`,

  impact: `
回答：我现在应该先看哪一项保障？

这题只回答目前最应该先看的保障，不要提 Full Review。

- 根据最低评分或最明显的保障Gap回答。
- 如果两项同分最低，可以一起讲。
- 可以引用评分，例如“医疗保障（24分）”。

如果医疗保障是重点：
- 有 Medical Card，就不要说没有医疗保障。
- 必须把“预期值”和“实际值”直接告诉用户。

格式可以类似：

“**你现在应该先看医疗保障（24分）。**

这次 Quick Check 的预期是 Annual Limit ≥ RM1百万，Room & Board ≥ RM300/天；你目前是 Annual Limit RM50k，Room & Board RM200/天。

**目前比较明显的保障Gap，就在这两个部分。**”

如果是人寿，重疾或意外：
- 比较 existing 和 expected_value。
- 统一使用“预期值”，不要使用“参考需求”或“参考值”。

不要主动提 Dr. Lawrence。
不要主动提 Full Review。
`,

  cash: `
回答：我有流动现金，为什么还是有保障Gap？

重点是解释“自己的现金”和“保险保障”作用不同。

回答方向：

“**流动现金和保险保障，作用不一样。**

现金是自己的钱，风险发生时用多少就少多少。

保险则是用保障杠杆，把符合保单条款的风险转给保险公司承担。”

可以自然使用“杠杆”这个词。

不要使用：
- RM1赔RM100。
- 固定赔付倍数。
- “现金够也不代表保障够”。
- “即使你有很多现金还是需要保险”。
- 任何像在反驳或教育客户的句子。

如果需要解释保障Gap：
可以简单说明保障Gap是在比较现有保障和预期值。

不要把答案带到某一个具体保障，除非真的有必要。
不要提 Full Review。
`,

  priority: `
回答：这个结果代表我一定要加保吗？

回答要非常简单。

第一句必须是：

“**不一定。**”

接下来表达：

“Quick Check 只是帮你找出目前的保障Gap。”

“让你马上知道哪里不足，更容易看懂自己的保障状况。”

就这样。

不要写：
- “不需要为了分数而买。”
- “为了分数而买保险。”
- “还要结合现有保单。”
- “还要结合家庭责任。”
- “根据自己的想法决定。”
- “建议购买。”
- Full Review。

不要推荐任何产品，公司，保费或保障金额。
`,

  next: `
回答：接下来我可以怎样做？

这题可以完整整理四项评分。

格式建议：

“**这次 Quick Check 已经把你的四项保障评分整理出来。**”

下一行：
“人寿 xx分｜重疾 xx分｜医疗 xx分｜意外 xx分。”

下一行：
“目前比较明显的保障Gap在于意外保障和人寿保障。”

下一行：
“如果想进一步了解这些Gap该怎样调整，可以由 Dr. Lawrence 亲自为你做 Full Review。”

必须根据实际评分决定哪些保障Gap比较明显，不要照抄例子。

句子太长就换行。

例如：

“目前比较明显的保障Gap在于意外保障和人寿保障。

如果想进一步了解这些Gap该怎样调整，可以由 Dr. Lawrence 亲自为你做 Full Review。”

这一题可以提 Full Review。
其他问题不要主动提 Full Review。
`
});

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_OUTPUT_CHARS = 1600;
const GEMINI_TIMEOUT_MS = 20000;
const MAX_AMOUNT = 10000000;

function safeNumber(
  value,
  min = 0,
  max = 100
) {
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
      safeNumber(
        domain?.score
      ),

    manual:
      Boolean(
        domain?.manual
      ),

    existing:
      safeOptionalAmount(
        domain?.existing
      ),

    expected_value:
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

      annual_expected:
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

      room_expected:
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

      annual_below_expected:
        Boolean(
          medical?.annual_below_reference
        ),

      room_below_expected:
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
      req.headers?.[
        "content-length"
      ] || 0
    );

  if (
    Number.isFinite(contentLength) &&
    contentLength >
      MAX_REQUEST_BYTES
  ) {
    return true;
  }

  try {
    return (
      Buffer.byteLength(
        JSON.stringify(
          req.body || {}
        ),
        "utf8"
      ) >
      MAX_REQUEST_BYTES
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
    req.headers?.[
      "content-type"
    ] || "";

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

你的工作，是把已经由 Quick Check 算好的结果，用自然的马来西亚华人中文解释清楚。

你只负责解释。
不要重新计算。
不要卖保险。
不要自己做 Full Review。

【语言】

- 用自然的马来西亚华人中文。
- 用“你”，不要用“您”。
- 直接，简单，有礼貌。
- 不要写成报告。
- 不要写成论文。
- 不要有很重的AI语气。
- 不要啰嗦。
- 中文逗号只能使用“，”。
- 中文句号使用“。”。
- 不要使用英文逗号“,”。
- 统一写“保障Gap”，中间不要空格。

可以保留这些英文：
Medical Card
Annual Limit
Room & Board
Full Review

【用词】

所有原本可能写成：
“参考需求”
“参考值”

统一改成：
“预期值”

医疗可以写：
“预期AL ≥ RM1百万”
“预期Room & Board ≥ RM300/天”

不要使用：
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
“预期值”
“保障Gap”
“该怎样调整”

【Quick Check 已经算好的规则】

整体评分：
人寿，重疾，医疗和意外四项评分的平均值。

人寿：
现有保障金额 / 预期值，
再换算成评分，
最高100分。

重疾：
现有保障金额 / 预期值，
再换算成评分，
最高100分。

意外：
现有保障金额 / 预期值，
再换算成评分，
最高100分。

医疗：
Annual Limit 最多80分。
Room & Board 最多20分。
两项得分加起来就是医疗评分。

这些数字都已经由 Quick Check 算好。

你只能解释提供给你的：
score
existing
expected_value
annual_points
room_points
overall_score

绝对不要重新计算或修改。

【金额写法】

使用马来西亚容易看的格式。

例如：
5000 → RM5k
50000 → RM50k
200000 → RM200k
750000 → RM750k
1000000 → RM1百万

不要输出：
RM200,000.00

【回答格式】

第一行一定直接回答问题，
并使用 Markdown Bold。

例如：

**不一定。**

第一行后面空一行。

默认使用2至3个短段落。

每段尽量只讲一个重点。

如果一句太长，
主动换到下一行。

不要为了凑3段而重复。

如果内容真的有3个不同重点以上，
才使用 point form。

Point form 最多3点。

每个回答最多使用1至2个 Bold。

【评分】

有需要时可以直接写：

人寿（47分）
重疾（94分）
医疗（80分）
意外（6分）

不要写：
“当前评分为47分”

不要每一题都重复四项评分。

只有“接下来我可以怎样做？”
可以主动把四项评分全部列出来。

如果某项是100分，
只能说“目前相对完整”。

不要说：
“完全没有风险”
“完全足够”
“以后不用管”

【Medical Card】

has_card = false：
才可以说目前没有 Medical Card。

has_card = true：
绝对不要说没有医疗保障。

如果医疗是重点，
可以直接告诉客户：

预期AL ≥ RM1百万
实际AL = RMxxx

预期Room & Board ≥ RM300/天
实际Room & Board = RMxxx/天

annual_points 和 room_points
已经由规则引擎算好。

直接解释，
不要自己重算。

【流动现金】

现金是自己的钱，
风险发生时用多少就少多少。

保险可以用“保障杠杆”来解释，
把符合保单条款的风险转给保险公司承担。

不要使用固定比例。

不要说：
“RM1赔RM100”
“现金够也不代表保障够”
“即使有钱还是需要保险”

不要用反驳客户的语气。

【Full Review】

第1题到第4题，
绝对不要主动提 Full Review。

只有第5题，
可以提：

“如果想进一步了解这些Gap该怎样调整，可以由 Dr. Lawrence 亲自为你做 Full Review。”

Full Review 是 Dr. Lawrence 亲自做，
不是 AI 做。

【安全规则】

- 不重新计算评分。
- 不修改评分。
- 不自行推算新的保障金额。
- 不自行推算新的保障Gap金额。
- 不推算保费。
- 不推荐具体保险产品。
- 不推荐保险公司。
- 不猜测没有提供的客户资料。
- 不制造焦虑。
- 不使用恐吓语气。
- 不接收或要求客户姓名，电话，Email或其他身份资料。

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
