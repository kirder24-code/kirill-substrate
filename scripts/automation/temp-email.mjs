/**
 * Temp Email module — mail.tm API with Guerrilla Mail fallback
 * Создаёт одноразовые email адреса для регистрации аккаунтов.
 */

const MAILTM_BASE = "https://api.mail.tm";

// Guerrilla Mail fallback (no auth needed, session-based)
async function createGuerrillaEmail(prefix) {
  const res = await fetch(`https://api.guerrillamail.com/ajax.php?f=get_email_address&lang=en`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const data = await res.json();
  const sidToken = data.sid_token;
  // Guerrilla assigns a random address; we can't choose the prefix easily
  return {
    address: data.email_addr,
    password: "guerrilla",
    token: sidToken,
    id: sidToken,
    provider: "guerrilla"
  };
}

async function waitForGuerrillaEmail(sidToken, timeoutMs = 120000, pollMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let seq = 0;
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=check_email&seq=${seq}&sid_token=${encodeURIComponent(sidToken)}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const data = await res.json();
    if (data.list && data.list.length > 0) {
      // Fetch full email
      const email = data.list[0];
      const fullRes = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${email.mail_id}&sid_token=${encodeURIComponent(sidToken)}`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const fullData = await fullRes.json();
      return { text: fullData.mail_body || "", subject: fullData.mail_subject || "" };
    }
    seq = data.seq || seq;
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`No Guerrilla email received within ${timeoutMs / 1000}s`);
}

// Получить список доступных доменов
async function getDomains() {
  const res = await fetch(`${MAILTM_BASE}/domains`);
  const data = await res.json();
  return (data["hydra:member"] || []).map(d => d.domain);
}

// Создать новый временный email (mail.tm с fallback на Guerrilla Mail)
export async function createTempEmail(prefix = null) {
  // Try mail.tm first
  try {
    const domains = await getDomains();
    if (!domains.length) throw new Error("No domains");

    const domain = domains[0];
    const username = prefix
      ? `${prefix}_${Math.random().toString(36).slice(2, 6)}`
      : `lbo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const address = `${username}@${domain}`;
    const password = `AutoBot${Date.now()}!`;

    const res = await fetch(`${MAILTM_BASE}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
      signal: AbortSignal.timeout(10000)
    });

    if (res.status === 429) {
      console.warn("[TempEmail] mail.tm rate limited, falling back to Guerrilla Mail");
      throw new Error("rate limited");
    }

    const data = await res.json();
    if (!data.id) throw new Error(`Failed: ${JSON.stringify(data)}`);

    const tokenRes = await fetch(`${MAILTM_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.token) throw new Error("Failed to get email token");

    return { address, password, token: tokenData.token, id: data.id, provider: "mailtm" };

  } catch (err) {
    // Fallback to Guerrilla Mail
    console.log("[TempEmail] Falling back to Guerrilla Mail:", err.message);
    return createGuerrillaEmail(prefix);
  }
}

// Ждать входящего письма (polling)
export async function waitForEmail(token, timeoutMs = 120000, pollMs = 3000, provider = "mailtm") {
  if (provider === "guerrilla") {
    return waitForGuerrillaEmail(token, timeoutMs, pollMs);
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILTM_BASE}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const messages = data["hydra:member"] || [];

    if (messages.length > 0) {
      const msgRes = await fetch(`${MAILTM_BASE}/messages/${messages[0].id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return await msgRes.json();
    }

    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`No email received within ${timeoutMs / 1000}s`);
}

// Извлечь ссылку верификации из письма
export function extractVerificationLink(emailBody) {
  const text = emailBody.text || emailBody.html || "";
  const urlMatch = text.match(/https?:\/\/[^\s"<>]+verif[^\s"<>]*/i)
    || text.match(/https?:\/\/[^\s"<>]+confirm[^\s"<>]*/i)
    || text.match(/https?:\/\/[^\s"<>]+activate[^\s"<>]*/i)
    || text.match(/https?:\/\/[^\s"<>]+verify[^\s"<>]*/i);
  return urlMatch ? urlMatch[0] : null;
}

// CLI test
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Creating temp email...");
  const email = await createTempEmail("lbo_scout");
  console.log("✅ Email created:", email.address);
  console.log("   Password:", email.password);
  console.log("   Waiting for test message... (send something to", email.address, ")");
}
