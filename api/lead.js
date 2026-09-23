import crypto from "node:crypto";

const HEADERS = [
  "No.",
  "Date",
  "Full Name",
  "Phone",
  "Overall Score",
  "Life Score",
  "Life Coverage",
  "CI Score",
  "CI Coverage",
  "Accident Score",
  "Accident Coverage",
  "Medical Score",
  "Medical Annual Limit",
  "Room & Board",
  "Cash Buffer Months",
  "Source",
  "Lead Status",
  "Remarks"
];

const MAX_REQUEST_BYTES =
  16 * 1024;

const MAX_AMOUNT =
  10000000;

const GOOGLE_TOKEN_URL =
  "https://oauth2.googleapis.com/token";

const SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";

let cachedAccessToken =
  null;

let cachedAccessTokenExpiresAt =
  0;

let cachedTabId =
  null;

let sheetReady =
  false;

function base64Url(input) {
  const buffer =
    Buffer.isBuffer(input)
      ? input
      : Buffer.from(
          String(input)
        );

  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function parseBody(req) {
  if (
    req.body &&
    typeof req.body ===
      "object" &&
    !Array.isArray(
      req.body
    )
  ) {
    return req.body;
  }

  if (
    typeof req.body ===
      "string"
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

function cleanName(value) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .slice(
      0,
      80
    );
}

function cleanPhone(value) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /[^\d+]/g,
      ""
    )
    .slice(
      0,
      16
    );
}

function cleanScore(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(n)
    )
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

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
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

  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      120,
      Math.round(
        n * 10
      ) / 10
    )
  );
}

function safeText(
  value,
  maxLength = 100
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}

function shortRM(value) {
  const n =
    cleanAmount(value);

  if (
    n === null
  ) {
    return "";
  }

  if (
    n >= 1000000
  ) {
    const v =
      Math.round(
        (
          n /
          1000000
        ) * 100
      ) / 100;

    return (
      `RM${String(v)
        .replace(
          /\.0+$/,
          ""
        )}百万`
    );
  }

  if (
    n >= 1000
  ) {
    const v =
      Math.round(
        (
          n /
          1000
        ) * 10
      ) / 10;

    return (
      `RM${String(v)
        .replace(
          /\.0$/,
          ""
        )}k`
    );
  }

  return `RM${n}`;
}

function coverage(
  existing,
  expected
) {
  const a =
    cleanAmount(
      existing
    );

  const b =
    cleanAmount(
      expected
    );

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

function malaysiaDate() {
  const parts =
    new Intl
      .DateTimeFormat(
        "en-GB",
        {
          timeZone:
            "Asia/Kuala_Lumpur",

          day:
            "2-digit",

          month:
            "2-digit",

          year:
            "numeric"
        }
      )
      .formatToParts(
        new Date()
      );

  const map =
    Object.fromEntries(
      parts.map(
        part => [
          part.type,
          part.value
        ]
      )
    );

  return (
    `${map.day}/${map.month}/${map.year}`
  );
}

function quoteSheetTitle(
  title
) {
  return (
    `'${String(title)
      .replace(
        /'/g,
        "''"
      )}'`
  );
}

async function getGoogleAccessToken() {
  const now =
    Math.floor(
      Date.now() /
      1000
    );

  if (
    cachedAccessToken &&
    cachedAccessTokenExpiresAt -
      60 >
      now
  ) {
    return cachedAccessToken;
  }

  const clientEmail =
    process.env
      .GOOGLE_SERVICE_ACCOUNT_EMAIL;

  const rawPrivateKey =
    process.env
      .GOOGLE_PRIVATE_KEY;

  if (
    !clientEmail ||
    !rawPrivateKey
  ) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED"
    );
  }

  const privateKey =
    rawPrivateKey
      .replace(
        /\\n/g,
        "\n"
      );

  const header =
    base64Url(
      JSON.stringify({
        alg:
          "RS256",

        typ:
          "JWT"
      })
    );

  const payload =
    base64Url(
      JSON.stringify({
        iss:
          clientEmail,

        scope:
          SHEETS_SCOPE,

        aud:
          GOOGLE_TOKEN_URL,

        iat:
          now,

        exp:
          now + 3600
      })
    );

  const unsignedToken =
    `${header}.${payload}`;

  const signer =
    crypto.createSign(
      "RSA-SHA256"
    );

  signer.update(
    unsignedToken
  );

  signer.end();

  const signature =
    base64Url(
      signer.sign(
        privateKey
      )
    );

  const assertion =
    `${unsignedToken}.${signature}`;

  const response =
    await fetch(
      GOOGLE_TOKEN_URL,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            grant_type:
              "urn:ietf:params:oauth:grant-type:jwt-bearer",

            assertion
          })
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok ||
    !data.access_token
  ) {
    console.error(
      "Google token error:",
      response.status,
      data?.error ||
        "UNKNOWN"
    );

    throw new Error(
      "GOOGLE_TOKEN_FAILED"
    );
  }

  cachedAccessToken =
    data.access_token;

  cachedAccessTokenExpiresAt =
    now +
    Number(
      data.expires_in ||
      3600
    );

  return cachedAccessToken;
}

async function googleRequest(
  url,
  options = {}
) {
  const token =
    await getGoogleAccessToken();

  const response =
    await fetch(
      url,
      {
        ...options,

        headers: {
          Authorization:
            `Bearer ${token}`,

          ...(
            options.body
              ? {
                  "Content-Type":
                    "application/json"
                }
              : {}
          ),

          ...(
            options.headers ||
            {}
          )
        }
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (
    !response.ok
  ) {
    console.error(
      "Google Sheets API error:",
      response.status,
      data?.error
        ?.message ||
        "UNKNOWN"
    );

    throw new Error(
      "GOOGLE_SHEETS_API_FAILED"
    );
  }

  return data;
}

async function getOrCreateTab(
  spreadsheetId,
  tabName
) {
  const metadata =
    await googleRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`
    );

  let sheet =
    metadata
      .sheets
      ?.find(
        item =>
          item
            ?.properties
            ?.title ===
          tabName
      );

  if (sheet) {
    return (
      sheet
        .properties
        .sheetId
    );
  }

  const created =
    await googleRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method:
          "POST",

        body:
          JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title:
                      tabName
                  }
                }
              }
            ]
          })
      }
    );

  const newSheetId =
    created
      .replies?.[0]
      ?.addSheet
      ?.properties
      ?.sheetId;

  if (
    newSheetId ===
    undefined
  ) {
    throw new Error(
      "GOOGLE_SHEET_TAB_CREATE_FAILED"
    );
  }

  return newSheetId;
}

async function readHeader(
  spreadsheetId,
  tabName
) {
  const range =
    `${quoteSheetTitle(tabName)}!A1:R1`;

  return googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  );
}

async function writeHeader(
  spreadsheetId,
  tabName
) {
  const range =
    `${quoteSheetTitle(tabName)}!A1:R1`;

  await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method:
        "PUT",

      body:
        JSON.stringify({
          range,

          majorDimension:
            "ROWS",

          values: [
            HEADERS
          ]
        })
    }
  );
}

async function formatSheet(
  spreadsheetId,
  tabId
) {
  await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method:
        "POST",

      body:
        JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId:
                    tabId,

                  gridProperties: {
                    frozenRowCount:
                      1
                  }
                },

                fields:
                  "gridProperties.frozenRowCount"
              }
            },

            {
              repeatCell: {
                range: {
                  sheetId:
                    tabId,

                  startColumnIndex:
                    0,

                  endColumnIndex:
                    HEADERS.length
                },

                cell: {
                  userEnteredFormat: {
                    horizontalAlignment:
                      "CENTER",

                    verticalAlignment:
                      "MIDDLE",

                    wrapStrategy:
                      "WRAP"
                  }
                },

                fields:
                  "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)"
              }
            },

            {
              repeatCell: {
                range: {
                  sheetId:
                    tabId,

                  startRowIndex:
                    0,

                  endRowIndex:
                    1,

                  startColumnIndex:
                    0,

                  endColumnIndex:
                    HEADERS.length
                },

                cell: {
                  userEnteredFormat: {
                    textFormat: {
                      bold:
                        true
                    }
                  }
                },

                fields:
                  "userEnteredFormat.textFormat.bold"
              }
            },

            {
              repeatCell: {
                range: {
                  sheetId:
                    tabId,

                  startColumnIndex:
                    3,

                  endColumnIndex:
                    4
                },

                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type:
                        "TEXT",

                      pattern:
                        "@"
                    }
                  }
                },

                fields:
                  "userEnteredFormat.numberFormat"
              }
            },

            {
              setDataValidation: {
                range: {
                  sheetId:
                    tabId,

                  startRowIndex:
                    1,

                  startColumnIndex:
                    16,

                  endColumnIndex:
                    17
                },

                rule: {
                  condition: {
                    type:
                      "ONE_OF_LIST",

                    values: [
                      {
                        userEnteredValue:
                          "New"
                      },
                      {
                        userEnteredValue:
                          "Contacted"
                      },
                      {
                        userEnteredValue:
                          "Follow Up"
                      },
                      {
                        userEnteredValue:
                          "Appointment"
                      },
                      {
                        userEnteredValue:
                          "Closed"
                      }
                    ]
                  },

                  strict:
                    true,

                  showCustomUi:
                    true
                }
              }
            },

            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId:
                    tabId,

                  dimension:
                    "COLUMNS",

                  startIndex:
                    0,

                  endIndex:
                    HEADERS.length
                }
              }
            }
          ]
        })
    }
  );
}

async function ensureSheetReady() {
  if (
    sheetReady &&
    cachedTabId !== null
  ) {
    return cachedTabId;
  }

  const spreadsheetId =
    process.env
      .GOOGLE_SHEET_ID;

  const tabName =
    process.env
      .GOOGLE_SHEET_TAB ||
    "Quick Check Leads";

  if (
    !spreadsheetId
  ) {
    throw new Error(
      "GOOGLE_SHEET_ID_NOT_CONFIGURED"
    );
  }

  const tabId =
    await getOrCreateTab(
      spreadsheetId,
      tabName
    );

  const headerData =
    await readHeader(
      spreadsheetId,
      tabName
    );

  const currentHeader =
    headerData
      .values?.[0] ||
    [];

  const headerMatches =
    currentHeader.length ===
      HEADERS.length &&
    HEADERS.every(
      (
        value,
        index
      ) =>
        currentHeader[
          index
        ] ===
        value
    );

  if (
    !headerMatches
  ) {
    await writeHeader(
      spreadsheetId,
      tabName
    );
  }

  await formatSheet(
    spreadsheetId,
    tabId
  );

  cachedTabId =
    tabId;

  sheetReady =
    true;

  return tabId;
}

async function appendLeadRow(
  values
) {
  const spreadsheetId =
    process.env
      .GOOGLE_SHEET_ID;

  const tabName =
    process.env
      .GOOGLE_SHEET_TAB ||
    "Quick Check Leads";

  await ensureSheetReady();

  const range =
    `${quoteSheetTitle(tabName)}!A:R`;

  const result =
    await googleRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
      {
        method:
          "POST",

        body:
          JSON.stringify({
            majorDimension:
              "ROWS",

            values: [
              values
            ]
          })
      }
    );

  const updatedRange =
    result
      .updates
      ?.updatedRange ||
    "";

  const rowMatch =
    updatedRange
      .match(
        /!A(\d+):R\d+$/
      );

  if (
    !rowMatch
  ) {
    throw new Error(
      "GOOGLE_SHEET_ROW_UNKNOWN"
    );
  }

  const rowNumber =
    Number(
      rowMatch[1]
    );

  const no =
    Math.max(
      1,
      rowNumber - 1
    );

  const noRange =
    `${quoteSheetTitle(tabName)}!A${rowNumber}`;

  await googleRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(noRange)}?valueInputOption=RAW`,
    {
      method:
        "PUT",

      body:
        JSON.stringify({
          range:
            noRange,

          majorDimension:
            "ROWS",

          values: [
            [no]
          ]
        })
    }
  );

  return no;
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
    !/[A-Za-z]/.test(
      fullName
    ) ||
    !/^\+?\d{8,15}$/.test(
      phone
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "INVALID_CONTACT"
      });
  }

  const life =
    safeDomain(
      body.life
    );

  const ci =
    safeDomain(
      body.ci
    );

  const accident =
    safeDomain(
      body.accident
    );

  const overallScore =
    cleanScore(
      body.overall_score
    );

  const medicalScore =
    cleanScore(
      body.medical
        ?.score
    );

  const medicalAnnual =
    cleanAmount(
      body.medical
        ?.annual_limit
    );

  const roomAndBoard =
    cleanAmount(
      body.medical
        ?.room_and_board
    );

  const cashBufferMonths =
    cleanMonths(
      body
        .cash_buffer_months
    );

  const row = [
    "",

    malaysiaDate(),

    fullName,

    phone,

    overallScore ??
      "",

    life.score ??
      "",

    coverage(
      life.existing,
      life.expected
    ),

    ci.score ??
      "",

    coverage(
      ci.existing,
      ci.expected
    ),

    accident.score ??
      "",

    coverage(
      accident.existing,
      accident.expected
    ),

    medicalScore ??
      "",

    medicalAnnual ===
      null
      ? ""
      : shortRM(
          medicalAnnual
        ),

    roomAndBoard ===
      null
      ? ""
      : `RM${roomAndBoard}`,

    cashBufferMonths ??
      "",

    "Quick Check",

    "New",

    safeText(
      body.remarks,
      300
    )
  ];

  try {
    const no =
      await appendLeadRow(
        row
      );

    return res
      .status(200)
      .json({
        ok:
          true,

        no
      });

  } catch (error) {
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
