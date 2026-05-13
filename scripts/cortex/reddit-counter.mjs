/**
 * scripts/cortex/reddit-counter.mjs
 *
 * Deterministic external counter. Reads r/AI_Agents new posts from the
 * public JSON endpoint, returns the number of submissions created within
 * the last `window_minutes` minutes. NO LLM, NO substrate state read.
 *
 * Used as the "world signal" for the first closed prediction loop.
 */

const DEFAULT_SUBREDDIT = "AskReddit";

async function fetchWithRetry(url, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "substrate-perception/0.1" } });
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        // exponential backoff: 5s, 15s, 45s
        const delay = 5_000 * Math.pow(3, i);
        process.stderr.write(`[reddit-counter] HTTP ${res.status}, retrying in ${delay}ms (attempt ${i + 1}/${attempts})\n`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`[reddit-counter] HTTP ${res.status} (non-retryable)`);
    } catch (e) {
      lastErr = e;
      const delay = 5_000 * Math.pow(3, i);
      process.stderr.write(`[reddit-counter] fetch error ${e.message}, retrying in ${delay}ms\n`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error("[reddit-counter] exhausted retries");
}

export async function countNewPostsLastNMinutes(window_minutes = 20, subreddit = DEFAULT_SUBREDDIT) {
  const res = await fetchWithRetry(
    `https://www.reddit.com/r/${subreddit}/new.json?limit=100`
  );
  const json = await res.json();
  const children = json?.data?.children ?? [];
  const cutoffSec = Date.now() / 1000 - window_minutes * 60;
  let count = 0;
  for (const child of children) {
    const t = Number(child?.data?.created_utc);
    if (Number.isFinite(t) && t >= cutoffSec) count++;
  }
  return count;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const window = Number(process.argv[2] ?? 20);
  countNewPostsLastNMinutes(window)
    .then(n => {
      process.stdout.write(`[reddit-counter] r/${DEFAULT_SUBREDDIT} new posts in last ${window}min: ${n}\n`);
      process.exit(0);
    })
    .catch(e => {
      process.stderr.write(`[reddit-counter] ERR ${e.message}\n`);
      process.exit(1);
    });
}
