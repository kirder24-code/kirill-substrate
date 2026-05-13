/**
 * LinkedIn Brand OS — Telegram Delivery Engine
 *
 * Sends daily content package to Telegram:
 * - One LinkedIn post (full text, ready to copy-paste)
 * - Generated image (if available)
 * - Implementation guide (for when client asks)
 * - Commercial proposal (ready to send)
 *
 * Run manually: node scripts/telegram-deliver.mjs
 * Run single post: node scripts/telegram-deliver.mjs zapier-migration
 * Scheduled: runs daily at 9:00 AM Calgary via cron
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = resolve(__dirname, "../apps/api/.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;
const OPENAI_API_KEY = env.OPENAI_API_KEY;
const GEMINI_API_KEY = env.GEMINI_API_KEY;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
  console.error("   Run: node scripts/telegram-setup.mjs");
  process.exit(1);
}

// ─── Telegram API helpers ──────────────────────────────────────────

async function sendMessage(text, options = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...options
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendMessage error: ${data.description}`);
  return data;
}

async function sendPhoto(photoPath, caption = "") {
  const imageBytes = readFileSync(photoPath);
  const blob = new Blob([imageBytes], { type: "image/png" });

  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo", blob, "image.png");
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendPhoto error: ${data.description}`);
  return data;
}

// ─── Content generation ────────────────────────────────────────────

const KIRILL_PROFILE = `
WHO KIRILL IS:
- AI Automation Consultant & Systems Architect, Calgary, Alberta, Canada
- 5.5 years Senior Project Manager at Verkhovna Rada of Ukraine (national parliament): ran electoral campaigns, managed 10+ person teams, zero-trust data environments, crisis management
- Physics degree: Radiophysics, Biomedical Electronics & Micro/Nanotechnologies
- Builds: n8n automations, LLM orchestrators, Notion hubs, local AI servers
- Live products: gaide.vercel.app, LinkedIn Brand OS
- Location: Calgary — energy sector, law firms, medical clinics = compliance-heavy market
- 525 LinkedIn followers, actively growing

KIRILL'S BRAND VOICE:
- Direct operator, not a marketer
- Short sentences (max 10 words each)
- Real numbers and specific timeframes
- References government ops experience as credibility anchor
- Anti-hype: never says "leverage", "synergy", "empower", "revolutionize", "non-negotiable"
- Story structure: before → problem → what I did → specific result → soft CTA
- Ends with: DM me [word], drop a comment, or an open question
- Max 220 words. No hashtags. No emojis except sparingly.
`;

const POST_QUEUE = [
  {
    id: "zapier-migration",
    topic: "Zapier → n8n migration",
    playbookId: "zapier-to-n8n-migration",
    prompt: `Write a LinkedIn post. The scenario: Kirill helped a client cut their Zapier bill from $840/month to near zero by migrating to self-hosted n8n. The migration took 6 days. The server costs $12/month (Hetzner VPS). Annual savings: ~$9,900. CTA: DM me "n8n".

Make it feel like a real client story. Specific numbers. Short punchy sentences. No corporate language.`
  },
  {
    id: "parliament-to-ai",
    topic: "Government ops → AI systems thinking",
    playbookId: "ai-operations-hub",
    prompt: `Write a LinkedIn post. The story: Kirill ran operations for national electoral campaigns at Ukraine's parliament for 5.5 years. The stakes: a single data leak ends careers. The lesson: systems either work perfectly or they don't. He now applies that same zero-tolerance thinking to building AI automation systems for founders. One client example: cut 3.5 hours/day of manual work using n8n + Notion + AI. CTA: "What's eating 3+ hours of your day?"

This should be the most powerful positioning post. The parliament story is the hook. Keep it humble but undeniably credible.`
  },
  {
    id: "local-ai-calgary",
    topic: "Local AI server for Calgary businesses",
    playbookId: "local-llm-server",
    prompt: `Write a LinkedIn post. The scenario: a Calgary law firm needed AI for contract analysis but could not send client data to OpenAI (NDA + PIPEDA compliance). Kirill deployed a local LLaMA server on their hardware. Now they process 200+ contracts/week. Data never leaves their office. Setup cost: $8,500 one-time. Monthly cloud AI they were considering: $2,000+. ROI in under 5 months. CTA: "Are you in oil & gas, legal, or healthcare in Calgary? Let's talk."

Local angle matters. Calgary = energy sector. Data compliance = real concern.`
  },
  {
    id: "founder-ops-waste",
    topic: "Founders wasting hours on manual ops",
    playbookId: "ai-operations-hub",
    prompt: `Write a LinkedIn post. The scenario: Kirill audited a 12-person SaaS company. The founder was spending 4 hours/day on: copying deal data from email to CRM, updating project status in Slack, manually sending weekly reports, chasing team for updates. Kirill built an ops hub with n8n + Notion + AI. Time saved: 3.5 hours/day for the founder. Cost: $4,500. Annual value of founder time recovered at $150/hour: $130,000+. CTA: "I'm taking 2 new ops projects this month. DM me 'ops'."

Very specific numbers. Very clear ROI. Short sentences.`
  },
  {
    id: "ai-vs-hiring",
    topic: "Automation vs hiring a new person",
    playbookId: "ai-operations-hub",
    prompt: `Write a LinkedIn post making the math clear: hiring a junior operations person costs $50,000+/year plus 2-3 months to onboard. Building an AI + n8n automation system costs $3,000-6,000 one-time and handles 80% of the same tasks 24/7. Kirill builds these systems. Reference: in his 5.5 years running parliamentary operations, he learned that smart systems outperform extra headcount every time. CTA: "What tasks are eating your team's time right now?"

This is a mindset shift post. Challenge the default assumption of "hire more people to scale."`
  },
  {
    id: "ai-lead-system",
    topic: "AI system that finds prospects automatically",
    playbookId: "ai-lead-generation-system",
    prompt: `Write a LinkedIn post. The scenario: Kirill built a system for a B2B consulting firm that monitors Reddit, HackerNews, and LinkedIn for buying signals, automatically researches each company (size, tech stack, recent posts), and drafts a personalized outreach message. The founder reviews and sends. Time per prospect went from 45 minutes to under 4 minutes. 18 qualified conversations in the first month. CTA: "What does your current prospecting process look like?"

This post should make B2B founders feel the pain of their current manual process and immediately see the alternative.`
  },
  {
    id: "data-security-post",
    topic: "Data security mistake with AI",
    playbookId: "local-llm-server",
    prompt: `Write a LinkedIn post. The insight: most small businesses are sending sensitive client data, financial records, and internal documents to OpenAI, Anthropic, and Google servers they don't control. This is a liability. Kirill builds local AI alternatives. Reference: learned about zero-trust data environments while managing sensitive political campaign data at Ukraine's parliament. The rule that protected careers there: if you can't control where data goes, don't send it. CTA: "If your business handles data you wouldn't want on a public server — let's talk."

Strong opinion post. Will generate debate. Perfect for reach.`
  }
];

async function callOpenAI(systemPrompt, userPrompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.85
    })
  });
  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) throw new Error(JSON.stringify(data));
  return JSON.parse(data.choices[0].message.content);
}

async function generatePost(postConfig) {
  return callOpenAI(
    `You are a ghostwriter for Kirill D.. ${KIRILL_PROFILE}

Write a LinkedIn post and return JSON with:
- hook: first sentence (max 8 words, punchy, surprising or contrarian)
- body: main content (150-180 words, short sentences, real numbers, story format)
- cta: last line (soft call to action, max 15 words)
- visualBrief: description for an image (what should it show, style, mood — 2 sentences)
- targetEmotion: what should the reader feel after reading (1 word)
- bestTimeToPost: "morning" or "midday" or "evening"`,
    postConfig.prompt
  );
}

async function generateProposal(topic) {
  return callOpenAI(
    `You are helping Kirill D. respond to a potential client inquiry. ${KIRILL_PROFILE}

Write a concise commercial proposal for the service described.
Return JSON with:
- subject: email subject line
- greeting: 2-sentence opener that shows you understand their problem
- whatWeDeliver: array of 3-4 specific deliverable strings
- howLong: timeline sentence
- investment: pricing range sentence (be specific)
- nextStep: one clear action (e.g., "15-minute discovery call")
- ps: one sentence that builds trust`,
    `Topic: ${topic}\nWrite a commercial proposal template for when a client reaches out about this.`
  );
}

async function generateImage(visualBrief, postId) {
  if (!OPENAI_API_KEY) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: `LinkedIn post image for AI automation consultant. ${visualBrief}. Style: clean, professional, cinematic dark tech aesthetic. Photorealistic. No text, no logos in image.`,
        n: 1,
        size: "1792x1024",
        quality: "hd"
      })
    });
    const data = await res.json();
    if (!data.data?.[0]?.url) {
      console.warn(`  ⚠️  DALL-E 3 failed: ${JSON.stringify(data).slice(0, 200)}`);
      return null;
    }

    // Download the image
    const imgRes = await fetch(data.data[0].url);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const imgPath = resolve(__dirname, `../.data/images/${postId}.png`);
    mkdirSync(resolve(__dirname, "../.data/images"), { recursive: true });
    writeFileSync(imgPath, imgBuffer);
    return imgPath;
  } catch (err) {
    console.warn(`  ⚠️  Image generation error: ${err.message}`);
    return null;
  }
}

// ─── Pick today's post ─────────────────────────────────────────────

function pickTodaysPost(specificId = null) {
  if (specificId) {
    const found = POST_QUEUE.find(p => p.id === specificId);
    if (!found) throw new Error(`Post ID not found: ${specificId}`);
    return found;
  }

  // Track which posts have been sent (simple file-based state)
  const statePath = resolve(__dirname, "../.data/telegram-state.json");
  let state = { sentIds: [], lastSentDate: null };
  try {
    state = JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {}

  const today = new Date().toISOString().slice(0, 10);
  if (state.lastSentDate === today) {
    console.log(`⚠️  Post already sent today (${today}). Use a post ID to force resend.`);
    process.exit(0);
  }

  // Find next unsent post
  const unsent = POST_QUEUE.filter(p => !state.sentIds.includes(p.id));
  if (unsent.length === 0) {
    // All sent — reset cycle
    state.sentIds = [];
    return POST_QUEUE[0];
  }
  return unsent[0];
}

function markSent(postId) {
  const statePath = resolve(__dirname, "../.data/telegram-state.json");
  let state = { sentIds: [], lastSentDate: null };
  try {
    state = JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {}

  if (!state.sentIds.includes(postId)) {
    state.sentIds.push(postId);
  }
  state.lastSentDate = new Date().toISOString().slice(0, 10);

  mkdirSync(resolve(__dirname, "../.data"), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ─── Main delivery ─────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const specificId = args[0] || null;

  const postConfig = pickTodaysPost(specificId);
  console.log(`\n🚀 Generating: ${postConfig.topic}`);

  // Generate content in parallel
  process.stdout.write("  📝 Writing post + proposal... ");
  const [post, proposal] = await Promise.all([
    generatePost(postConfig),
    generateProposal(postConfig.topic)
  ]);
  console.log("✅");

  process.stdout.write("  🎨 Generating image with DALL-E 3... ");
  const imagePath = await generateImage(post.visualBrief || "", postConfig.id);
  console.log(imagePath ? "✅" : "⏭️  skipped");

  // Build full post text
  const fullText = `${post.hook}\n\n${post.body}\n\n${post.cta}`;

  console.log("\n📤 Sending to Telegram...\n");

  // ── Message 1: Header ──
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    timeZone: "America/Edmonton"
  });
  await sendMessage(
    `<b>📅 LinkedIn Content — ${today}</b>\n\n` +
    `<b>Topic:</b> ${postConfig.topic}\n` +
    `<b>Post at:</b> ${post.bestTimeToPost === "morning" ? "9:00 AM" : post.bestTimeToPost === "midday" ? "12:00 PM" : "6:00 PM"} Calgary\n` +
    `<b>Target emotion:</b> ${post.targetEmotion}`
  );

  // ── Message 2: Image (if generated) ──
  if (imagePath && existsSync(imagePath)) {
    try {
      await sendPhoto(imagePath, `🖼 Visual for: <b>${postConfig.topic}</b>`);
    } catch (err) {
      await sendMessage(`🖼 <i>Image brief: ${post.visualBrief}</i>\n\n(Generate manually with this description)`);
    }
  } else {
    await sendMessage(`🖼 <b>Visual brief:</b>\n<i>${post.visualBrief}</i>`);
  }

  // ── Message 3: Post text (ready to copy) ──
  await sendMessage(
    `<b>✍️ LINKEDIN POST — COPY & PASTE:</b>\n\n` +
    `<code>${fullText}</code>`
  );

  // ── Message 4: Implementation guide ──
  const implGuide = [
    `<b>💼 SERVICE: ${postConfig.topic}</b>`,
    `<b>Playbook ID:</b> <code>${postConfig.playbookId}</code>`,
    ``,
    `<b>When client responds to this post:</b>`,
    `• Ask: "What's your current setup and what's eating your time?"`,
    `• Qualify: budget $3,000-$10,000, timeline 2-8 weeks`,
    `• Offer: 15-min discovery call (no pitch, just diagnosis)`,
    ``,
    `<b>Your tech stack for this:</b> n8n + Notion + OpenAI + Hetzner VPS`
  ].join("\n");
  await sendMessage(implGuide);

  // ── Message 5: Commercial proposal ──
  if (proposal) {
    const proposalText = [
      `<b>📧 COMMERCIAL PROPOSAL — READY TO SEND:</b>`,
      ``,
      `<b>Subject:</b> ${proposal.subject}`,
      ``,
      `<b>Opening:</b>`,
      proposal.greeting,
      ``,
      `<b>What I deliver:</b>`,
      ...(proposal.whatWeDeliver || []).map(d => `• ${d}`),
      ``,
      `<b>Timeline:</b> ${proposal.howLong}`,
      `<b>Investment:</b> ${proposal.investment}`,
      ``,
      `<b>Next step:</b> ${proposal.nextStep}`,
      ``,
      `<b>P.S.</b> ${proposal.ps}`
    ].join("\n");
    await sendMessage(proposalText);
  }

  // ── Message 6: Footer with action buttons ──
  const postRef = postConfig.id;
  const deliveryKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ Опубликовал в LinkedIn", callback_data: `mark_published:${postRef}` }
      ],
      [
        { text: "❌ Не публикую — скажу почему", callback_data: `not_publishing:${postRef}` }
      ],
      [
        { text: "📧 КП для этого поста", callback_data: `post_proposal:${postRef}` },
        { text: "📋 Все посты", callback_data: "show_posts" }
      ],
      [
        { text: "💼 Воронка лидов", callback_data: "show_pipeline" },
        { text: "🤖 Меню", callback_data: "menu" }
      ]
    ]
  };
  await sendMessage(
    `<b>✅ Пакет доставлен.</b>\n\n` +
    `<b>Твои действия:</b>\n` +
    `1. Скопируй текст поста выше\n` +
    `2. Опубликуй в LinkedIn\n` +
    `3. Нажми кнопку <b>✅ Опубликовал</b> — система начнёт отслеживать\n` +
    `4. Когда кто-то напишет — нажми <b>📧 КП</b>\n\n` +
    `<i>Следующий пост завтра в 9:00 Calgary.</i>`,
    { reply_markup: deliveryKeyboard }
  );

  // Mark as sent
  const statePath = resolve(__dirname, "../.data/telegram-state.json");
  let state = { sentIds: [], lastSentDate: null };
  try {
    state = JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {}
  if (!state.sentIds.includes(postConfig.id)) state.sentIds.push(postConfig.id);
  state.lastSentDate = new Date().toISOString().slice(0, 10);
  mkdirSync(resolve(__dirname, "../.data"), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Save to post archive for /posts and /proposal commands
  const archivePath = resolve(__dirname, "../.data/post-archive.json");
  let archive = [];
  try { archive = JSON.parse(readFileSync(archivePath, "utf-8")); } catch {}
  archive.unshift({
    id: postConfig.id,
    topic: postConfig.topic,
    date: new Date().toISOString().slice(0, 10),
    postText: fullText,
    imagePath: imagePath || null,
    proposal: proposal || null
  });
  writeFileSync(archivePath, JSON.stringify(archive, null, 2));

  console.log(`\n✅ Delivered to Telegram: ${postConfig.id}`);
  console.log(`   ${POST_QUEUE.length - state.sentIds.length} posts remaining in cycle\n`);
}

main().catch(err => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
