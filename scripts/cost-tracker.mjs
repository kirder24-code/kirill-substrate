import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const costsFile = resolve(__dirname, "../.logs/loop-costs.jsonl");
try {
  const lines = readFileSync(costsFile, "utf-8").trim().split("\n").filter(Boolean);
  const costs = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const today = costs.filter(c => c.timestamp?.startsWith(new Date().toISOString().slice(0, 10)));
  const totalAll = costs.reduce((s, c) => s + (c.estimated_cost_usd || 0), 0);
  const totalToday = today.reduce((s, c) => s + (c.estimated_cost_usd || 0), 0);
  console.log(JSON.stringify({ total_cycles: costs.length, total_cost_usd: totalAll.toFixed(2), today_cycles: today.length, today_cost_usd: totalToday.toFixed(2) }));
} catch { console.log(JSON.stringify({ total_cycles: 0, total_cost_usd: "0.00", today_cycles: 0, today_cost_usd: "0.00" })); }
