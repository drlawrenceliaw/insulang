const ALLOWED_EVENTS = new Set([
  "quick_check_start",
  "quick_check_complete",
  "manual_full_review_required",
  "ai_open",
  "whatsapp_result_click",
  "whatsapp_full_review_click",
  "print_result_click",
  "restart_click"
]);

function clean(value, max = 120) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

function cleanDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output = {};

  for (const [key, val] of Object.entries(value).slice(0, 10)) {
    const safeKey = clean(key, 40);

    if (!safeKey) continue;

    if (
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "boolean"
    ) {
      output[safeKey] =
        typeof val === "string" ? clean(val, 120) : val;
    }
  }

  return output;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "Insu Lang Funnel Event"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({
      ok: false,
      code: "METHOD_NOT_ALLOWED"
    });
  }

  const webhookUrl = process.env.LEAD_WEBHOOK_URL;
  const webhookSecret = process.env.LEAD_WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    return res.status(500).json({
      ok: false,
      code: "WEBHOOK_NOT_CONFIGURED"
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const eventName = clean(body.event_name, 60);
    const sessionId = clean(body.session_id, 100);

    if (!ALLOWED_EVENTS.has(eventName)) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_EVENT"
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_SESSION"
      });
    }

    const payload = {
      secret: webhookSecret,
      kind: "event",

      event_name: eventName,
      session_id: sessionId,

      occurred_at: clean(body.occurred_at, 40),
      page: clean(body.page, 120),

      source: clean(body.source, 80) || "Direct",
      medium: clean(body.medium, 80),
      campaign: clean(body.campaign, 120),
      content: clean(body.content, 120),
      term: clean(body.term, 120),
      ref: clean(body.ref, 120),
      referrer: clean(body.referrer, 300),

      details: cleanDetails(body.details)
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    let data = {};

    try {
      data = JSON.parse(text);
    } catch (_) {}

    if (!response.ok || data?.ok === false) {
      console.error(
        "Funnel webhook failed:",
        response.status,
        data?.code || "UNKNOWN"
      );

      return res.status(502).json({
        ok: false,
        code: "WEBHOOK_FAILED"
      });
    }

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    console.error(
      "Funnel event error:",
      error?.message || error
    );

    return res.status(500).json({
      ok: false,
      code: "EVENT_FAILED"
    });
  }
}
