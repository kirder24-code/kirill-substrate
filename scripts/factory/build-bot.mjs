/**
 * BUILD BOT — @LBO_Build_bot
 * Строитель проектов. Активируется когда сделка закрыта.
 *
 * Задачи:
 * 1. Получает задачу от SalesBot (deal closed)
 * 2. Генерирует полный план проекта
 * 3. Создаёт n8n workflow схему
 * 4. Создаёт Notion хаб для клиента
 * 5. Для AI серверов — генерирует спецификацию железа
 * 6. Сопровождает Кирилла шаг за шагом
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { getDb, BOTS, CHAT_ID, callAI, tgSend, tgSendToKirill, createTask, claimTasks, completeTask, heartbeat, logActivity, reportError, clearError } from "./orchestrator.mjs";
import { readWiki, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_TOKEN = BOTS.build.token;
const BOT_ID = "build";

const KIRILL_PROFILE = `
Kirill D. — AI Automation Consultant, Calgary, Alberta, Canada.
Tech stack: n8n (self-hosted on Hetzner VPS), Notion, OpenAI GPT-4o, LLaMA local models,
Ollama, Open WebUI, Ubuntu Server, Cloudflare Tunnel, PostgreSQL, SQLite.
Services: workflow automation, AI ops hubs, local AI servers.
`;

// ── Generate project plan ────────────────────────────────────────────
async function generateProjectPlan(deal, lead) {
  const serviceType = deal.service_type || "custom-automation";

  return callAI(
    `${KIRILL_PROFILE}
You are BuildBot. Generate a complete project delivery plan.
Return JSON with:
{
  "project_name": "...",
  "phases": [
    {
      "phase": 1,
      "name": "...",
      "days": "Day 1-2",
      "tasks": ["task1", "task2"],
      "deliverable": "what client gets at end of phase"
    }
  ],
  "tech_stack": ["tool1", "tool2"],
  "checklist": ["item1", "item2"],
  "client_onboarding": "what to tell client on day 1",
  "success_metrics": ["metric1", "metric2"]
}`,
    `Service: ${serviceType}
Client: ${lead.name}, ${lead.company || ""}
Pain: ${lead.pain_description}
Amount: $${deal.amount} CAD
Notes: ${lead.notes || "none"}`
  );
}

// ── Generate n8n workflow schema ─────────────────────────────────────
async function generateN8nSchema(serviceType, pain) {
  return callAI(
    `${KIRILL_PROFILE}
Generate an n8n workflow architecture description.
Return JSON with:
{
  "workflow_name": "...",
  "trigger": "what starts the workflow",
  "nodes": [
    { "name": "Node Name", "type": "n8n-node-type", "purpose": "what it does" }
  ],
  "integrations": ["tool1", "tool2"],
  "estimated_setup_hours": 4,
  "complexity": "low|medium|high"
}`,
    `Service type: ${serviceType}
Client pain: ${pain}
Build a practical n8n automation to solve this.`
  );
}

// ── Generate AI server spec ──────────────────────────────────────────
async function generateServerSpec(productType, clientSize) {
  return callAI(
    `You are a hardware consultant specializing in local AI servers for businesses.
Generate a complete AI server specification. Return JSON with:
{
  "hardware": {
    "cpu": "...",
    "ram": "...",
    "storage": "...",
    "gpu": "...",
    "estimated_cost_cad": 0
  },
  "software_stack": ["Ubuntu 24.04", "Ollama", "Open WebUI", "n8n"],
  "models_recommended": [
    { "name": "...", "size": "...", "use_case": "..." }
  ],
  "network": "...",
  "backup": "...",
  "setup_steps": ["step1", "step2"],
  "monthly_running_cost": 0,
  "where_to_buy": ["Amazon.ca", "Canada Computers", "Newegg.ca"]
}`,
    `Product: ${productType}
Client size: ${clientSize}
Location: Calgary, Alberta, Canada
Compliance: PIPEDA required`
  );
}

// ── Save project to DB ───────────────────────────────────────────────
function saveProject(db, deal, lead, plan) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const totalPhases = (plan.phases || []).length;

  db.prepare(`
    INSERT INTO mvp_projects (id, deal_id, lead_id, project_type, status, playbook_id,
      plan_json, checklist_json, total_phases, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `).run(
    id, deal.id, lead.id, deal.service_type || "custom",
    deal.service_type,
    JSON.stringify(plan),
    JSON.stringify(plan.checklist || []),
    totalPhases, now, now
  );

  return id;
}

// ── Save project files ───────────────────────────────────────────────
function saveProjectFiles(projectId, leadName, plan, n8nSchema, serverSpec) {
  const dir = resolve(__dirname, `../../.data/projects/${projectId}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(`${dir}/project-plan.json`, JSON.stringify({ plan, n8nSchema, serverSpec }, null, 2));

  // Human-readable checklist
  let checklist = `# Project: ${plan.project_name}\nClient: ${leadName}\n\n`;
  checklist += `## Phases\n\n`;
  for (const phase of (plan.phases || [])) {
    checklist += `### Phase ${phase.phase}: ${phase.name} (${phase.days})\n`;
    for (const task of (phase.tasks || [])) {
      checklist += `- [ ] ${task}\n`;
    }
    checklist += `**Deliverable:** ${phase.deliverable}\n\n`;
  }
  checklist += `## Success Metrics\n`;
  for (const m of (plan.success_metrics || [])) {
    checklist += `- ${m}\n`;
  }
  writeFileSync(`${dir}/checklist.md`, checklist);

  return dir;
}

// ── Send project brief to Kirill ─────────────────────────────────────
async function notifyProjectStart(deal, lead, plan, n8nSchema, serverSpec, projectDir) {
  const isServer = deal.service_type?.includes("local-ai") || deal.service_type?.includes("server");

  let text = `<b>🚀 BUILD BOT АКТИВИРОВАН</b>\n\n`;
  text += `<b>Проект:</b> ${plan.project_name}\n`;
  text += `<b>Клиент:</b> ${lead.name} — ${lead.company || ""}\n`;
  text += `<b>Сумма:</b> $${deal.amount.toLocaleString()} CAD\n\n`;

  text += `<b>📋 Фазы проекта:</b>\n`;
  for (const phase of (plan.phases || [])) {
    text += `${phase.phase}. <b>${phase.name}</b> (${phase.days})\n`;
    text += `   → ${phase.deliverable}\n`;
  }

  text += `\n<b>🛠 Технологии:</b> ${(plan.tech_stack || []).join(", ")}\n`;

  if (n8nSchema) {
    text += `\n<b>🔄 n8n Workflow:</b> ${n8nSchema.workflow_name}\n`;
    text += `Trigger: ${n8nSchema.trigger}\n`;
    text += `Nodes: ${n8nSchema.nodes?.length || 0} | Est. setup: ${n8nSchema.estimated_setup_hours}h\n`;
  }

  if (isServer && serverSpec) {
    text += `\n<b>🖥 AI Server Spec:</b>\n`;
    text += `CPU: ${serverSpec.hardware?.cpu}\n`;
    text += `RAM: ${serverSpec.hardware?.ram}\n`;
    text += `GPU: ${serverSpec.hardware?.gpu}\n`;
    text += `Estimated hardware cost: $${serverSpec.hardware?.estimated_cost_cad?.toLocaleString()} CAD\n`;
    text += `Where to buy: ${(serverSpec.where_to_buy || []).join(", ")}\n`;
    text += `Models: ${(serverSpec.models_recommended || []).map(m => m.name).join(", ")}\n`;
  }

  text += `\n<b>👋 Что сказать клиенту сегодня:</b>\n<i>${plan.client_onboarding}</i>`;
  text += `\n\n<b>📁 Все файлы проекта:</b>\n${projectDir}`;

  await tgSendToKirill(text);
}

// ── Main BuildBot run ────────────────────────────────────────────────
async function runBuild() {
  const db = getDb();
  heartbeat(db, BOT_ID, "BuildBot", "waiting for deals");

  const tasks = claimTasks(db, BOT_ID);

  for (const task of tasks) {
    if (task.task_type === "start_project") {
      const { dealId, leadId, leadName, amount, serviceType } = task.payload;

      try {
        heartbeat(db, BOT_ID, "BuildBot", `building project for ${leadName}`);
        console.log(`[BuildBot] Starting project: ${serviceType} for ${leadName}`);

        const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId) ||
          { id: dealId, service_type: serviceType, amount: amount || 0 };
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId) ||
          { id: leadId, name: leadName, pain_description: "", company: "" };

        // Generate plan
        process.stdout.write("[BuildBot] Generating project plan... ");
        const plan = await generateProjectPlan(deal, lead);
        console.log("✅");

        // Generate n8n schema (for automation projects)
        let n8nSchema = null;
        const isAutomation = !serviceType?.includes("server");
        if (isAutomation) {
          process.stdout.write("[BuildBot] Generating n8n schema... ");
          n8nSchema = await generateN8nSchema(serviceType, lead.pain_description);
          console.log("✅");
        }

        // Generate server spec (for AI Box products)
        let serverSpec = null;
        const isServer = serviceType?.includes("local-ai") || serviceType?.includes("server");
        if (isServer) {
          process.stdout.write("[BuildBot] Generating server specification... ");
          serverSpec = await generateServerSpec(serviceType, lead.company_size || "small");
          console.log("✅");
        }

        // Save to DB and files
        const projectId = saveProject(db, deal, lead, plan);
        const projectDir = saveProjectFiles(projectId, leadName, plan, n8nSchema, serverSpec);

        await logActivity(db, "build", `Проект для <b>${leadName}</b> запущен — план готов, ${plan.phases?.length || 0} фаз`);
        // Notify Kirill
        await notifyProjectStart(deal, lead, plan, n8nSchema, serverSpec, projectDir);

        completeTask(db, task.id, { projectId, phases: plan.phases?.length });
        console.log(`[BuildBot] Project created: ${projectId}`);

      } catch (err) {
        console.error(`[BuildBot] Error: ${err.message}`);
        await tgSendToKirill(`⚠️ BuildBot ошибка при создании проекта: ${err.message}`);
      }
    }

    // Phase complete notification
    if (task.task_type === "phase_complete") {
      const { projectId, phaseNumber } = task.payload;
      const project = db.prepare(`SELECT * FROM mvp_projects WHERE id = ?`).get(projectId);
      if (project) {
        const plan = JSON.parse(project.plan_json || "{}");
        const nextPhase = (plan.phases || [])[phaseNumber];
        if (nextPhase) {
          await tgSendToKirill(
            `✅ <b>Фаза ${phaseNumber} завершена!</b>\n\n` +
            `<b>Следующий шаг — Фаза ${phaseNumber + 1}: ${nextPhase.name}</b>\n` +
            `${(nextPhase.tasks || []).map(t => `• ${t}`).join("\n")}`
          );
        } else {
          await tgSendToKirill(
            `🎉 <b>Проект завершён!</b>\nВсе фазы выполнены. Пора запросить отзыв и реферал.\n\nЗафиксируй: /project_done ${task.payload.dealId || ""}`
          );
        }
        db.prepare(`UPDATE mvp_projects SET current_phase = ?, updated_at = ? WHERE id = ?`)
          .run(phaseNumber + 1, new Date().toISOString(), projectId);
        completeTask(db, task.id);
      }
    }
  }

  heartbeat(db, BOT_ID, "BuildBot", `tick complete — ${tasks.length} tasks`, {}, {
    status: "ok",
    last_success_at: new Date().toISOString(),
    error: null
  });
  try { clearError(db, BOT_ID); } catch {}
  db.close();
  console.log(`[BuildBot] Done. Processed ${tasks.length} tasks.`);
}

// ── Live mode (every 10min — polls for deal_closed tasks) ────────────
async function liveMode() {
  console.log(`[BuildBot] Live mode started — polling every 10 min`);
  while (true) {
    try {
      await runBuild();
    } catch (err) {
      console.error(`[BuildBot] Live mode error:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_ID, "BuildBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
    }
    await new Promise(r => setTimeout(r, 10 * 60 * 1000));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "live") liveMode().catch(console.error);
  else runBuild().catch(console.error);
}

export { runBuild };
