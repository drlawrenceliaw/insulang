const MAX_REQUEST_BYTES = 16 * 1024;
const WEBHOOK_TIMEOUT_MS = 12000;
const MAX_AMOUNT = 10000000;

function parseBody(req) {
  if (
    req.body &&
    typeof req.body === "object" &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
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
    return (
      Buffer.byteLength(
        JSON.stringify(req.body || {}),
        "utf8"
      ) > MAX_REQUEST_BYTES
    );
  } catch {
    return true;
  }
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function cleanPhone(value) {
  return String(value || "")
    .trim()
    .replace(/[^\d+]/g, "")
    .slice(0, 16);
}

function cleanScore(value) {
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

  return Math.max(
    0,
    Math.min(100, Math.round(n))
  );
}

function cleanAmount(value) {
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

  return Math.max(
    0,
    Math.min(
      MAX_AMOUNT,
      Math.round(n)
    )
  );
}

function cleanMonths(value) {
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

  return Math.max(
    0,
    Math.min(
      120,
      Math.round(n * 10) / 10
    )
  );
}

function shortRM(value) {
  const n = cleanAmount(value);

  if (n === null) {
    return "";
  }

  if (n >= 1000000) {
    const v =
      Math.round(
        (n / 1000000) * 100
      ) / 100;

    return (
      `RM${String(v)
        .replace(/\.0+$/, "")}百万`
    );
  }

  if (n >= 1000) {
    const v =
      Math.round(
        (n / 1000) * 10
      ) / 10;

    return (
      `RM${String(v)
        .replace(/\.0$/, "")}k`
    );
  }

  return `RM${n}`;
}

function coverage(
  existing,
  expected
) {
  const a =
    cleanAmount(existing);

  const b =
    cleanAmount(expected);

  if (
    a === null ||
    b === null
  ) {
    return "";
  }

  return (
    `${shortRM(a)} / ${shortRM(b)}`
  );
}

function safeDomain(domain) {
  return {
    score:
      cleanScore(
        domain?.score
      ),

    existing:
      cleanAmount(
        domain?.existing
      ),

    expected:
      cleanAmount(
        domain?.expected
      )
  };
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
    String(
      req.headers?.["content-type"] || ""
    ).toLowerCase();

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

  if (requestTooLarge(req)) {
    return res
      .status(413)
      .json({
        error:
          "REQUEST_TOO_LARGE"
      });
  }

  const webhookUrl =
    process.env.LEAD_WEBHOOK_URL;

  const webhookSecret =
    process.env.LEAD_WEBHOOK_SECRET;

  if (
    !webhookUrl ||
    !webhookSecret
  ) {
    console.error(
      "Missing LEAD_WEBHOOK_URL or LEAD_WEBHOOK_SECRET"
    );

    return res
      .status(503)
      .json({
        error:
          "LEAD_STORAGE_NOT_CONFIGURED"
      });
  }

  const body =
    parseBody(req);

  if (!body) {
    return res
      .status(400)
      .json({
        error:
          "INVALID_REQUEST"
      });
  }

  const fullName =
    cleanName(
      body.full_name
    );

  const phone =
    cleanPhone(
      body.phone
    );

  if (
    fullName.length < 2 ||
    !/^\+?\d{8,15}$/.test(phone)
  ) {
    console.error(
      "Invalid lead contact data"
    );

    return res
      .status(400)
      .json({
        error:
          "INVALID_CONTACT"
      });
  }

  const life =
    safeDomain(body.life);

  const ci =
    safeDomain(body.ci);

  const accident =
    safeDomain(
      body.accident
    );

  const medicalScore =
    cleanScore(
      body.medical?.score
    );

  const medicalAnnual =
    cleanAmount(
      body.medical?.annual_limit
    );

  const roomAndBoard =
    cleanAmount(
      body.medical?.room_and_board
    );

  const payload = {
    secret:
      webhookSecret,

    full_name:
      fullName,

    phone,

    overall_score:
      cleanScore(
        body.overall_score
      ),

    life_score:
      life.score,

    life_coverage:
      coverage(
        life.existing,
        life.expected
      ),

    ci_score:
      ci.score,

    ci_coverage:
      coverage(
        ci.existing,
        ci.expected
      ),

    accident_score:
      accident.score,

    accident_coverage:
      coverage(
        accident.existing,
        accident.expected
      ),

    medical_score:
      medicalScore,

    medical_annual_limit:
      medicalAnnual === null
        ? ""
        : shortRM(
            medicalAnnual
          ),

    room_and_board:
      roomAndBoard === null
        ? ""
        : `RM${roomAndBoard}`,

    cash_buffer_months:
      cleanMonths(
        body.cash_buffer_months
      ),

    source:
      "Quick Check",

    lead_status:
      "New",

    remarks:
      String(
        body.remarks || ""
      )
        .trim()
        .slice(0, 300)
  };

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      WEBHOOK_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        webhookUrl,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              payload
            ),

          signal:
            controller.signal
        }
      );

    clearTimeout(timeout);

    const raw =
      await response.text();

    let data = {};

    try {
      data =
        JSON.parse(raw);
    } catch {
      data = {};
    }

    if (
      !response.ok ||
      data?.ok !== true
    ) {
      console.error(
        "Apps Script webhook failed:",
        response.status,
        raw.slice(0, 500)
      );

      return res
        .status(502)
        .json({
          error:
            "LEAD_SAVE_FAILED"
        });
    }

    return res
      .status(200)
      .json({
        ok: true,
        no: data?.no ?? null
      });

  } catch (error) {
    clearTimeout(timeout);

    if (
      error?.name ===
      "AbortError"
    ) {
      console.error(
        "Apps Script webhook timeout"
      );

      return res
        .status(504)
        .json({
          error:
            "LEAD_SAVE_TIMEOUT"
        });
    }

    console.error(
      "Lead save error:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return res
      .status(500)
      .json({
        error:
          "LEAD_SAVE_FAILED"
      });
  }
}
