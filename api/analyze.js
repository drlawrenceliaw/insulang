const QUESTION_GUIDANCE = Object.freeze({
  why_score: `
回答：为什么会得到这个评分？

这题只解释评分怎样得出，不评价哪里好或不好。

第一句可以类似：
“你的整体评分（57分）是人寿，重疾，医疗和意外评分的平均值。”

接着解释：
- 人寿，重疾和意外，是按照现有保障/预期值来计算的，最高100分。
- 可以写成：“人寿（54分），重疾（56分）和意外（14分），是按照现有保障/预期值来计算的，最高100分。”
- 医疗保障只需要说：“医疗保障（70分）是根据目前的 Annual Limit 和 Room & Board 评估出来的。”
- 不要透露 Annual Limit 和 Room & Board 的内部评分占比或各自得分。
- 不要使用“参考需求”或“参考值”，统一使用“预期值”。
- 不要讲哪项保障不足，不要讲 Full Review。
`,

  impact: `
回答：我现在应该先看哪一项保障？

这题必须只回答一项保障。
- 直接使用 priority_domain 指定的那一项。
- 即使两项同分，也只回答 priority_domain，不要一次列两项或三项。
- 可以引用评分，例如“你现在应该先看人寿保障（14分）。”
- 如果是人寿，重疾或意外，比较现有保障和预期值。
- 如果是医疗保障，比较实际 Annual Limit / Room & Board 和预期值。
- 不要提第二项保障。
- 不要提 Full Review。
`,

  cash: `
回答：我有流动现金，为什么还是有保障Gap？

回答方向：
“流动现金和保险保障，作用不一样。”

接着说明：
“现金是自己的钱，风险发生时用多少就少多少，而保险是用保障杠杆，把风险转给保险公司来承担。”

如果需要解释保障Gap，只要简单说：保障Gap是在比较现有保障和预期值之间还有多少距离。

不要说“符合保单条款”。
不要使用固定赔付倍数。
不要说“RM1赔RM100”。
不要提 Full Review。
`,

  priority: `
回答：这个结果代表我一定要加保吗？

第一句必须是：
“**不一定。**”

接着只需要表达：
“Quick Check 只是帮你找出目前的保障Gap。”
“让你马上知道哪里不足，更容易看懂自己的保障状况。”

不要写“不需要为了分数而买”。
不要重新讲家庭责任或现有保单。
不要提 Full Review。
`,

  next: `
回答：接下来我可以怎样做？

这题可以整理四项评分。

格式：
“**这次 Quick Check 已经把你的四项保障评分整理出来。**”

下一行可以写：
“人寿 xx分｜重疾 xx分｜意外 xx分｜医疗 xx分。”

再指出目前比较明显的保障Gap。
如果其他保障也较低，使用“还需提升”，不要使用“提升空间”。

如果句子太长就换行。

最后可以写：
“如果想进一步了解这些Gap该怎样调整，可以由 Dr. Lawrence 亲自为你做 Full Review。”
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

function getPriorityDomain(domains) {
  const order = [
    "life",
    "ci",
    "accident",
    "medical"
  ];

  const labels = {
    life:
      "人寿保障",

    ci:
      "重疾保障",

    accident:
      "意外保障",

    medical:
      "医疗保障"
  };

  let chosen =
    order[0];

  let lowest =
    Number.POSITIVE_INFINITY;

  for (const key of order) {
    const score =
      safeNumber(
        domains?.[key]?.score
      );

    if (score < lowest) {
      lowest = score;
      chosen = key;
    }
  }

  return {
    key:
      chosen,

    label:
      labels[chosen],

    score:
      lowest
  };
}

function safeProfile(profile) {
  const domains =
    profile?.domains || {};

  const medical =
    profile?.medical || {};

  const safeDomains = {
    life:
      safeDomain(
        domains?.life
      ),

    ci:
      safeDomain(
        domains?.ci
      ),

    accident:
      safeDomain(
        domains?.accident
      ),

    medical:
      safeDomain(
        domains?.medical
      )
  };

  return {
    overall_score:
      safeNumber(
        profile?.overall_score
      ),

    domains:
      safeDomains,

    priority_domain:
      getPriorityDomain(
        safeDomains
      ),

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

      room_and_board:
        safeNumber(
          medical?.room_and_board,
          0,
          5000
        ),

      room_expected:
        300,

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

function parseBody(req) {
  if (
    req.body &&
    typeof req.body === "object" &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }

  if (
    typeof req.body === "string"
  ) {
    try {
      return JSON.parse(
        req.body
      );
    } catch {
      return null;
    }
  }

  return null;
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

  return Object
    .prototype
    .hasOwnProperty
    .call(
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
    Number.isFinite(
      contentLength
    ) &&
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

  if (
    req.method !== "POST"
  ) {
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
    String(
      req.headers?.[
        "content-type"
      ] || ""
    )
      .toLowerCase();

  if (
    !contentType.includes(
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

  if (
    requestTooLarge(req)
  ) {
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

  const body =
    parseBody(req);

  if (
    !isValidRequest(body)
  ) {
    return res
      .status(400)
      .json({
        error:
          "INVALID_REQUEST"
      });
  }

  const safe =
    safeProfile(
      body.profile
    );

  const question =
    body.question;

  const prompt = `你是 Insu Lang 的 AI ANALYSIS。

你的工作，是把已经由 Quick Check 算好的结果，用自然的马来西亚华人中文解释清楚。

你只负责解释，不重新计算，不卖保险，也不自己做 Full Review。

【语言】
- 用自然的马来西亚华人中文。
- 用“你”，不要用“您”。
- 直接，简单，有礼貌，不啰嗦。
- 中文逗号只能使用“，”。
- 中文句号使用“。”。
- 不要使用英文逗号“,”。
- 统一写“保障Gap”，中间不要空格。
- 可以保留 Medical Card，Annual Limit，Room & Board，Full Review。

【用词】
- 所有“参考需求”“参考值”统一写成“预期值”。
- 不要使用“提升空间”，改成“还需提升”。
- 不要使用“建议优先检视”“风险暴露”“优化方案”“整体规划”“现阶段”“项目”。

【评分逻辑】
- 整体评分是人寿，重疾，医疗和意外四项评分的平均值。
- 人寿，重疾和意外按照现有保障/预期值计算，最高100分。
- 医疗根据 Annual Limit 和 Room & Board 评估。
- 不要透露医疗内部评分权重，也不要透露 Annual Limit 或 Room & Board 各自得几分。
- 所有分数已经由 Quick Check 算好，绝对不要重新计算或修改。

【回答格式】
- 第一行一定直接回答问题，并使用 Markdown Bold。
- 第一行后空一行。
- 默认2至3个短段落，每段尽量只讲一个重点。
- 句子太长就换行。
- 如果两句话已经讲清楚就结束。
- 每个回答最多1至2个 Bold。

【金额写法】
例如：RM50k，RM200k，RM750k，RM1百万，RM1.35百万。

【Medical Card】
- has_card = false 才可以说目前没有 Medical Card。
- has_card = true 绝对不要说没有医疗保障。
- 如果医疗是重点，可以比较：预期AL ≥ RM1百万，实际AL = RMxxx；预期Room & Board ≥ RM300/天，实际Room & Board = RMxxx/天。
- 不要说内部评分占比。

【流动现金】
- 现金是自己的钱，风险发生时用多少就少多少。
- 保险可以说“用保障杠杆，把风险转给保险公司来承担”。
- 不要加“符合保单条款的风险”。
- 不要使用固定赔付比例。

【Full Review】
- 第1题到第4题不要主动提 Full Review。
- 只有第5题可以提 Dr. Lawrence 亲自做 Full Review。

【隐私】
- 不接收也不要求客户姓名，手机号或其他身份资料。

【匿名 Quick Check 结果】
${JSON.stringify(safe)}

【本次问题】
${QUESTION_GUIDANCE[question]}

只输出最后给客户看的答案，不要输出分析过程，不要输出标题，不要输出 JSON。`;

  const model =
    "gemini-3.1-flash-lite";

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      GEMINI_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method:
            "POST",

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
                  role:
                    "user",

                  parts: [
                    {
                      text:
                        prompt
                    }
                  ]
                }
              ],

              generationConfig: {
                temperature:
                  0.1,

                maxOutputTokens:
                  500
              }
            })
        }
      );

    clearTimeout(timeout);

    if (
      !response.ok
    ) {
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
      return res
        .status(502)
        .json({
          error:
            "EMPTY_AI_RESPONSE"
        });
    }

    return res
      .status(200)
      .json({
        answer:
          text.slice(
            0,
            MAX_OUTPUT_CHARS
          )
      });

  } catch (error) {
    clearTimeout(timeout);

    if (
      error?.name ===
      "AbortError"
    ) {
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
