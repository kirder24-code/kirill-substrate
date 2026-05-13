/**
 * FACTORY RUNNER
 * Запускает нужного бота по аргументу.
 * Используется cron для 24/7 работы.
 *
 * Использование:
 *   node scripts/factory/run-factory.mjs orchestrator
 *   node scripts/factory/run-factory.mjs scout
 *   node scripts/factory/run-factory.mjs sales
 *   node scripts/factory/run-factory.mjs analytics
 *   node scripts/factory/run-factory.mjs build
 *   node scripts/factory/run-factory.mjs trend
 *   node scripts/factory/run-factory.mjs status
 */

const agent = process.argv[2];

if (!agent) {
  console.error("Usage: node run-factory.mjs <agent>");
  console.error("Agents: orchestrator | scout | sales | analytics | build | status");
  process.exit(1);
}

switch (agent) {
  case "orchestrator": {
    const { orchestratorTick } = await import("./orchestrator.mjs");
    await orchestratorTick();
    break;
  }
  case "scout": {
    const { runScout } = await import("./scout-bot.mjs");
    await runScout();
    break;
  }
  case "sales": {
    const { runSales } = await import("./sales-bot.mjs");
    await runSales();
    break;
  }
  case "analytics": {
    const { runAnalytics } = await import("./analytics-bot.mjs");
    await runAnalytics();
    break;
  }
  case "build": {
    const { runBuild } = await import("./build-bot.mjs");
    await runBuild();
    break;
  }
  case "trend": {
    const { runTrend } = await import("./trend-bot.mjs");
    await runTrend();
    break;
  }
  case "content": {
    const { runContentFactory } = await import("./content-bot.mjs");
    await runContentFactory();
    break;
  }
  case "status": {
    const { getDb, BOTS, CHAT_ID, tgSend } = await import("./orchestrator.mjs");
    const { sendDailyStatus } = await import("./analytics-bot.mjs");
    const db = getDb();
    await sendDailyStatus(db);
    db.close();
    console.log("Status sent to Telegram.");
    break;
  }
  case "outreach": {
    const { runOutreach } = await import("../outreach/send-outreach.mjs");
    await runOutreach();
    break;
  }
  case "outreach-monitor": {
    const { checkForReplies } = await import("../outreach/monitor-replies.mjs");
    await checkForReplies();
    break;
  }
  case "linkedin-hunter": {
    const { runLinkedInHunter } = await import("./linkedin-hunter.mjs");
    await runLinkedInHunter();
    break;
  }
  case "builder": {
    const { runBuilderBot } = await import("./builder-bot.mjs");
    await runBuilderBot();
    break;
  }
  case "builder-demo": {
    const { runBuilderBot } = await import("./builder-bot.mjs");
    // demo mode via direct script
    const { execSync } = await import("child_process");
    execSync("node scripts/factory/builder-bot.mjs demo", { stdio: "inherit" });
    break;
  }
  case "brief": {
    const { runBriefAgent } = await import("./brief-agent.mjs");
    await runBriefAgent();
    break;
  }
  case "telegram-control": {
    const { runTelegramControl } = await import("./telegram-control.mjs");
    await runTelegramControl();
    break;
  }
  case "service": {
    const { runServiceBot } = await import("./service-bot.mjs");
    await runServiceBot();
    break;
  }
  case "reddit-monitor": {
    const { runRedditMonitor } = await import("./reddit-monitor.mjs");
    await runRedditMonitor();
    break;
  }
  case "research": {
    const { runResearchBot } = await import("./research-bot.mjs");
    await runResearchBot();
    break;
  }
  case "pr": {
    const { runPRBot } = await import("./pr-bot.mjs");
    await runPRBot();
    break;
  }
  case "community": {
    const { runCommunityBot, autoReplyToJobPosts } = await import("./community-bot.mjs");
    await runCommunityBot();
    // Also auto-reply to job posts where we have clean notes
    const { getDb } = await import("./orchestrator.mjs");
    const db = getDb();
    await autoReplyToJobPosts(db);
    db.close();
    break;
  }
  case "ph": {
    const { runPHBot } = await import("./ph-bot.mjs");
    await runPHBot();
    break;
  }
  case "learn": {
    const { runLearnBot } = await import("./learn-bot.mjs");
    await runLearnBot();
    break;
  }
  case "evolution": {
    const { runEvolutionBot } = await import("./evolution-bot.mjs");
    await runEvolutionBot();
    break;
  }
  case "idea": {
    const { runIdeaBot } = await import("./idea-bot.mjs");
    await runIdeaBot();
    break;
  }
  case "followups": {
    const { runFollowups } = await import("../outreach/send-followups.mjs");
    await runFollowups();
    break;
  }
  default:
    console.error(`Unknown agent: ${agent}`);
    process.exit(1);
}
