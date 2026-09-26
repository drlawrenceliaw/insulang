const MAX_BODY_BYTES = 20000;

function cleanText(value, max = 120) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function safeNumber(
  value,
  min = 0,
  max = 100000000
) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.min(
    max,
    Math.max(min, n)
  );
}

function safeScore(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  return Math.round(
    safeNumber(
      value,
      0,
      100
    )
  );
}

function normalizeMalaysiaPhone(
  value
) {
  let phone =
    String(value ?? "")
      .replace(/\D/g, "");

  if (
    phone.startsWith("60")
  ) {
    phone =
      "0" +
      phone.slice(2);
  }

  else if (
    phone.startsWith("1")
  ) {
    phone =
      "0" +
      phone;
  }

  return phone.slice(
    0,
    20
  );
}

function formatMoney(value) {

  const n =
    Math.round(
      safeNumber(
        value,
        0,
        100000000
      )
    );

  if (n >= 1000000) {

    const v =
      n / 1000000;

    return (
      "RM" +
      (
        Number.isInteger(v)
          ? v
          : v
              .toFixed(2)
              .replace(/0+$/, "")
              .replace(/\.$/, "")
      ) +
      "百万"
    );
  }

  if (n >= 1000) {

    const v =
      n / 1000;

    return (
      "RM" +
      (
        Number.isInteger(v)
          ? v
          : v
              .toFixed(1)
              .replace(/\.0$/, "")
      ) +
      "k"
    );
  }

  return `RM${n}`;
}

function coverageText(domain) {

  if (
    !domain ||
    typeof domain !== "object"
  ) {
    return "";
  }

  return (
    `${formatMoney(domain.existing)}` +
    ` / ${formatMoney(domain.expected)}`
  );
}

function roomText(value) {

  const n =
    safeNumber(
      value,
      0,
      100000
    );

  if (!n) {
    return "RM0/天";
  }

  if (n > 300) {
    return "> RM300";
  }

  return `RM${Math.round(n)}/天`;
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
        ok: false,
        code:
          "METHOD_NOT_ALLOWED"
      });
  }

  const webhookUrl =
    process.env
      .LEAD_WEBHOOK_URL;

  const webhookSecret =
    process.env
      .LEAD_WEBHOOK_SECRET;

  if (
    !webhookUrl ||
    !webhookSecret
  ) {

    return res
      .status(503)
      .json({
        ok: false,
        code:
          "LEAD_NOT_CONFIGURED"
      });
  }

  try {

    const body =
      req.body || {};

    const bodySize =
      Buffer.byteLength(
        JSON.stringify(body),
        "utf8"
      );

    if (
      bodySize >
      MAX_BODY_BYTES
    ) {

      return res
        .status(413)
        .json({
          ok: false,
          code:
            "PAYLOAD_TOO_LARGE"
        });
    }

    const fullName =
      cleanText(
        body.full_name,
        80
      );

    const phone =
      normalizeMalaysiaPhone(
        body.phone
      );

    if (
      fullName.length < 2 ||
      !/^01\d{8,9}$/.test(
        phone
      )
    ) {

      return res
        .status(400)
        .json({
          ok: false,
          code:
            "INVALID_LEAD"
        });
    }

    const payload = {

      secret:
        webhookSecret,

      kind:
        "lead",

      full_name:
        fullName,

      phone,

      overall_score:
        safeScore(
          body.overall_score
        ),

      life_score:
        safeScore(
          body.life?.score
        ),

      life_coverage:
        coverageText(
          body.life
        ),

      ci_score:
        safeScore(
          body.ci?.score
        ),

      ci_coverage:
        coverageText(
          body.ci
        ),

      accident_score:
        safeScore(
          body.accident?.score
        ),

      accident_coverage:
        coverageText(
          body.accident
        ),

      medical_score:
        safeScore(
          body.medical?.score
        ),

      medical_annual_limit:
        formatMoney(
          body.medical
            ?.annual_limit
        ),

      room_and_board:
        roomText(
          body.medical
            ?.room_and_board
        ),

      cash_buffer_months:
        safeNumber(
          body.cash_buffer_months,
          0,
          600
        ),

      source:
        cleanText(
          body.source,
          80
        ) || "Direct",

      medium:
        cleanText(
          body.medium ?? body.utm_medium,
          80
        ),

      campaign:
        cleanText(
          body.campaign,
          120
        ),

      content:
        cleanText(
          body.content ?? body.utm_content,
          120
        ),

      term:
        cleanText(
          body.term ?? body.utm_term,
          120
        ),

      ref:
        cleanText(
          body.ref ?? body.referral_code,
          120
        ),

      // 这两个是之前 Sheet 空白的重点
      consent_at:
        cleanText(
          body.consent_at,
          40
        ),

      legal_version:
        cleanText(
          body.legal_version,
          40
        ),

      // Priority 先保留后台，
      // 但网页 / PDF / WhatsApp 已经不显示
      priority_area:
        cleanText(
          body.priority_area,
          40
        ),

      funnel_session_id:
        cleanText(
          body.funnel_session_id,
          100
        ),

      remarks:
        cleanText(
          body.remarks,
          300
        )
    };


    const response =
      await fetch(
        webhookUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              payload
            )
        }
      );


    const text =
      await response.text();


    let data = {};

    try {
      data =
        JSON.parse(text);
    } catch (_) {}


    if (
      !response.ok ||
      data?.ok === false
    ) {

      console.error(
        "Lead webhook failed:",
        response.status,
        data?.error ||
          "UNKNOWN"
      );

      return res
        .status(502)
        .json({
          ok: false,
          code:
            "LEAD_SAVE_FAILED"
        });
    }


    return res
      .status(200)
      .json({
        ok: true
      });


  } catch (error) {

    console.error(
      "Lead endpoint error:",
      error?.message ||
        error
    );

    return res
      .status(500)
      .json({
        ok: false,
        code:
          "LEAD_SAVE_FAILED"
      });
  }
}
