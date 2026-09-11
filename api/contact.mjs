const RESEND_ENDPOINT = "https://api.resend.com/emails";

const LIMITS = {
  name: 120,
  company: 160,
  contact: 200,
  message: 4000,
};

const MIN_FILL_MS = 3000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitize(value, max, multiline) {
  if (typeof value !== "string") return "";
  let out = value.replace(/\r\n?/g, "\n");
  out = out.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
  if (multiline) {
    out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  } else {
    out = out.replace(/\s+/g, " ");
  }
  return out.trim().slice(0, max);
}

async function readJsonBody(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b) && Object.keys(b).length) {
    return b;
  }
  if (Buffer.isBuffer(b) || typeof b === "string") {
    const raw = Buffer.isBuffer(b) ? b.toString("utf8") : b;
    return raw ? JSON.parse(raw) : {};
  }
  const raw = await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100000) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  return raw ? JSON.parse(raw) : {};
}

function emailRow(label, value, multiline) {
  const cell = "padding:6px 10px;border:1px solid #d5dbe4;vertical-align:top;";
  const style = multiline ? cell + "white-space:pre-wrap;" : cell;
  return (
    "<tr>" +
    '<th style="' + cell + 'text-align:left;font-weight:600;width:180px;color:#10141c;">' +
    escapeHtml(label) +
    "</th>" +
    '<td style="' + style + 'color:#10141c;">' + escapeHtml(value || "—") + "</td>" +
    "</tr>"
  );
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Метод не поддерживается." });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return res.status(400).json({ ok: false, error: "Некорректный запрос." });
  }
  if (!body || typeof body !== "object") body = {};

  // honeypot: заполненное скрытое поле = бот, отвечаем успехом, не выдавая проверку
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return res.status(200).json({ ok: true, message: "Заявка отправлена. Спасибо!" });
  }

  // timing: слишком быстрая отправка или устаревшая форма = бот
  const ts = Number(body.ts);
  const now = Date.now();
  if (!Number.isFinite(ts) || now - ts < MIN_FILL_MS || now - ts > MAX_AGE_MS) {
    return res.status(200).json({ ok: true, message: "Заявка отправлена. Спасибо!" });
  }

  const name = sanitize(body.name, LIMITS.name, false);
  const company = sanitize(body.company, LIMITS.company, false);
  const contact = sanitize(body.contact, LIMITS.contact, false);
  const message = sanitize(body.message, LIMITS.message, true);

  if (!contact || !message) {
    return res
      .status(422)
      .json({ ok: false, error: "Заполните обязательные поля: контакт для ответа и описание задачи." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.CONTACT_TO_EMAIL;
  const fromEmail = process.env.CONTACT_FROM_EMAIL;

  if (!apiKey || !toEmail || !fromEmail) {
    console.error("[contact] missing env configuration");
    return res.status(500).json({ ok: false, error: "Сервис временно недоступен. Попробуйте позже." });
  }

  const sentAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const text = [
    "Новая заявка — Data Desk",
    "",
    "Имя: " + (name || "—"),
    "Компания: " + (company || "—"),
    "Контакт для ответа: " + contact,
    "",
    "Описание задачи:",
    message,
    "",
    "Время получения заявки: " + sentAt,
  ].join("\n");

  const html =
    '<h3 style="margin:0 0 12px;font-family:Arial,sans-serif;color:#10141c;">Новая заявка — Data Desk</h3>' +
    '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">' +
    emailRow("Имя", name, false) +
    emailRow("Компания", company, false) +
    emailRow("Контакт для ответа", contact, false) +
    emailRow("Описание задачи", message, true) +
    emailRow("Время получения заявки", sentAt, false) +
    "</table>";

  const payload = {
    from: fromEmail,
    to: [toEmail],
    subject: "Новая заявка — Data Desk",
    text,
    html,
  };
  if (EMAIL_RE.test(contact)) {
    payload.reply_to = contact;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[contact] resend error", response.status, data && data.message ? data.message : "");
      return res.status(502).json({ ok: false, error: "Не удалось отправить заявку. Попробуйте позже." });
    }

    return res.status(200).json({ ok: true, message: "Заявка отправлена. Спасибо!" });
  } catch (err) {
    console.error("[contact] fetch failed", err && err.message ? err.message : err);
    return res.status(502).json({ ok: false, error: "Не удалось отправить заявку. Попробуйте позже." });
  }
}
