/**
 * TEST BOT — Autonomous Testing Agent
 *
 * Постоянно активный процесс (не cron).
 * Слушает события от других ботов, тестирует продукты, находит баги.
 * Общается с BuilderBot через event bus когда находит проблемы.
 *
 * Запуск: node scripts/factory/test-bot.mjs
 * Supervisor будет держать его живым 24/7
 */

import {
  getDb, pollMessages, sendMessage, markMessageActedOn,
  heartbeat, setIntelligence, getIntelligenceKey,
  callAI, MODEL_STRONG, MODEL_MINI
} from "./orchestrator.mjs";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_NAME = "test-bot";
const CLIENTS_DIR = resolve(__dirname, "../../clients");
const POLL_INTERVAL = 10000; // 10 секунд

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────

async function mainLoop() {
  console.log(`[TestBot] Starting autonomous testing agent...`);

  while (true) {
    try {
      const db = getDb();

      // 1. Проверить сообщения от других ботов
      const messages = pollMessages(db, BOT_NAME, 5);

      for (const msg of messages) {
        await handleMessage(db, msg);
      }

      // 2. Периодически сканировать все продукты (каждые 30 минут)
      const lastScan = getIntelligenceKey(db, BOT_NAME, "scan", "last_full_scan");
      const timeSinceLastScan = lastScan ? Date.now() - new Date(lastScan).getTime() : 999999999;

      if (timeSinceLastScan > 30 * 60 * 1000) { // 30 минут
        await scanAllProducts(db);
        setIntelligence(db, BOT_NAME, "scan", "last_full_scan", new Date().toISOString(), 100);
      }

      // 3. Heartbeat
      heartbeat(db, BOT_NAME, "TestBot", "polling messages", {
        messages_processed: messages.length,
        last_scan: lastScan || "never"
      });

      db.close();
    } catch (err) {
      console.error(`[TestBot] Error in main loop:`, err.message);
    }

    await sleep(POLL_INTERVAL);
  }
}

// ── MESSAGE HANDLERS ──────────────────────────────────────────────────────────

async function handleMessage(db, msg) {
  console.log(`[TestBot] Message from ${msg.from_bot}: ${msg.message_type}`);

  if (msg.message_type === "build_complete") {
    // BuilderBot закончил строить продукт → запустить тесты
    const result = await testProduct(db, msg.payload);
    markMessageActedOn(db, msg.id, result);

    if (result.status === "failed") {
      // Отправить BuilderBot детали ошибок
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "builder-bot",
        messageType: "test_failed",
        payload: {
          product: msg.payload.product,
          errors: result.errors,
          severity: result.severity,
          suggested_fix: result.suggested_fix
        },
        priority: result.severity === "critical" ? 10 : 7
      });
    } else {
      // Всё ОК → уведомить MarketBot что продукт готов
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "market-bot",
        messageType: "product_ready",
        payload: {
          product: msg.payload.product,
          path: msg.payload.path,
          tests_passed: result.tests_passed
        },
        priority: 8
      });
    }
  }

  if (msg.message_type === "retest_request") {
    // BuilderBot пофиксил баг → перетестировать
    const result = await testProduct(db, msg.payload);
    markMessageActedOn(db, msg.id, result);

    if (result.status === "passed") {
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "builder-bot",
        messageType: "tests_passed",
        payload: { product: msg.payload.product },
        priority: 8
      });
    }
  }
}

// ── TESTING LOGIC ─────────────────────────────────────────────────────────────

async function testProduct(db, { product, path }) {
  console.log(`[TestBot] Testing product: ${product} at ${path}`);

  const productPath = resolve(CLIENTS_DIR, path);

  if (!existsSync(productPath)) {
    return {
      status: "failed",
      severity: "critical",
      errors: [`Product path not found: ${productPath}`],
      suggested_fix: "Check BuilderBot output path"
    };
  }

  const errors = [];
  const warnings = [];

  // 1. Проверить структуру файлов (для архитектурных документов)
  const requiredFiles = ["README.md", "brief.md", "solution.md"];
  for (const file of requiredFiles) {
    if (!existsSync(resolve(productPath, file))) {
      errors.push(`Missing required file: ${file}`);
    }
  }

  // 2. Если есть package.json → проверить зависимости
  const pkgPath = resolve(productPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

      // Проверить есть ли тесты
      if (!pkg.scripts?.test) {
        warnings.push("No test script defined in package.json");
      } else {
        // Запустить тесты
        try {
          const { stdout, stderr } = await execAsync("npm test", { cwd: productPath, timeout: 60000 });
          console.log(`[TestBot] Tests passed for ${product}`);
        } catch (testErr) {
          errors.push(`Tests failed: ${testErr.message}`);
        }
      }
    } catch (parseErr) {
      errors.push(`Invalid package.json: ${parseErr.message}`);
    }
  }

  // 3. Если есть n8n workflow → проверить валидность JSON
  const workflowFiles = existsSync(productPath)
    ? readdirSync(productPath).filter(f => f.endsWith(".json") && f.includes("workflow"))
    : [];

  for (const wf of workflowFiles) {
    try {
      const content = readFileSync(resolve(productPath, wf), "utf-8");
      const parsed = JSON.parse(content);
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        errors.push(`Invalid n8n workflow: ${wf} (missing nodes array)`);
      }
    } catch (jsonErr) {
      errors.push(`Invalid JSON in ${wf}: ${jsonErr.message}`);
    }
  }

  // 4. Проверить что solution.md содержит архитектуру
  const solutionPath = resolve(productPath, "solution.md");
  if (existsSync(solutionPath)) {
    const content = readFileSync(solutionPath, "utf-8");
    if (content.length < 1000) {
      warnings.push("solution.md seems too short (< 1KB)");
    }
    if (!content.includes("Architecture") && !content.includes("Technical")) {
      warnings.push("solution.md missing architecture section");
    }
  }

  // Сохранить результаты
  const result = {
    status: errors.length === 0 ? "passed" : "failed",
    severity: errors.length > 0 ? "critical" : "none",
    errors,
    warnings,
    tests_passed: errors.length === 0,
    tested_at: new Date().toISOString()
  };

  setIntelligence(db, BOT_NAME, "test_results", product, result, 90);

  // Если есть ошибки → предложить фикс
  if (errors.length > 0) {
    result.suggested_fix = `Create missing files: ${errors.join(", ")}`;
  }

  return result;
}

async function scanAllProducts(db) {
  console.log(`[TestBot] Scanning all products in ${CLIENTS_DIR}...`);

  if (!existsSync(CLIENTS_DIR)) {
    console.log(`[TestBot] No clients directory found`);
    return;
  }

  const products = readdirSync(CLIENTS_DIR).filter(f => {
    const stat = existsSync(resolve(CLIENTS_DIR, f));
    return stat;
  });

  for (const product of products) {
    const result = await testProduct(db, { product, path: product });

    if (result.status === "failed") {
      // Уведомить BuilderBot о найденных проблемах
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "builder-bot",
        messageType: "bug_found",
        payload: {
          product,
          errors: result.errors,
          severity: result.severity,
          suggested_fix: result.suggested_fix
        },
        priority: result.severity === "critical" ? 9 : 5
      });
    }
  }

  console.log(`[TestBot] Scan complete. Tested ${products.length} products.`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mainLoop().catch(err => {
    console.error(`[TestBot] Fatal error:`, err);
    process.exit(1);
  });
}
