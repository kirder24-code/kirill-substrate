/**
 * scripts/cortex/hn-counter.mjs
 *
 * External counter via HackerNews public Firebase API. No auth, generous
 * limits, monotonic. `maxitem.json` returns the max item id across all of
 * HN — it increments with every new comment, post, or poll. We predict
 * the DELTA over a window: how much it grows between predict-time and
 * observe-time.
 */

const ENDPOINT = "https://hacker-news.firebaseio.com/v0/maxitem.json";

async function fetchWithRetry(attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(ENDPOINT, { headers: { "User-Agent": "substrate-perception/0.1" } });
      if (res.ok) return res;
      const delay = 3_000 * Math.pow(2, i);
      process.stderr.write(`[hn-counter] HTTP ${res.status}, retry ${i + 1}/${attempts} in ${delay}ms\n`);
      await new Promise(r => setTimeout(r, delay));
    } catch (e) {
      lastErr = e;
      const delay = 3_000 * Math.pow(2, i);
      process.stderr.write(`[hn-counter] fetch err: ${e.message}, retry in ${delay}ms\n`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error("[hn-counter] retries exhausted");
}

export async function getMaxItemId() {
  const res = await fetchWithRetry();
  const text = (await res.text()).trim();
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n)) throw new Error(`[hn-counter] bad payload: ${text}`);
  return n;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  getMaxItemId()
    .then(n => { process.stdout.write(`[hn-counter] maxitem=${n}\n`); process.exit(0); })
    .catch(e => { process.stderr.write(`[hn-counter] ERR ${e.message}\n`); process.exit(1); });
}
