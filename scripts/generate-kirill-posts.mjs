/**
 * LinkedIn Brand OS — Kirill's Content Engine
 *
 * Generates:
 * 1. LinkedIn post (in Kirill's voice)
 * 2. Visual brief (for Gemini image generation)
 * 3. Implementation notes (how to actually deliver the service)
 * 4. Commercial proposal template (ready when client writes)
 */

import { readFileSync } from "fs";
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

const OPENAI_API_KEY = env.OPENAI_API_KEY;
const GEMINI_API_KEY = env.GEMINI_API_KEY || null;

// Load playbooks
const playbooks = JSON.parse(
  readFileSync(resolve(__dirname, "../.data/implementation-playbooks.json"), "utf-8")
).playbooks;

const KIRILL_PROFILE = `
WHO KIRILL IS:
- AI Automation Consultant & Systems Architect, Calgary, Alberta, Canada
- 5.5 years Senior Project Manager at Verkhovna Rada of Ukraine (national parliament): ran electoral campaigns, managed 10+ person teams, zero-trust data environments, crisis management, procurement
- Physics degree: Radiophysics, Biomedical Electronics & Micro/Nanotechnologies (Kharkiv National University)
- Builds: n8n automations, LLM orchestrators, Notion hubs, local AI servers
- Live products: gaide.vercel.app (AI research framework), LinkedIn Brand OS (this system)
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

const POST_PROMPTS = [
  {
    id: "zapier-migration",
    playbookId: "zapier-to-n8n-migration",
    topic: "Zapier → n8n migration",
    prompt: `Write a LinkedIn post. The scenario: Kirill helped a client cut their Zapier bill from $840/month to near zero by migrating to self-hosted n8n. The migration took 6 days. The server costs $12/month (Hetzner VPS). Annual savings: ~$9,900. CTA: DM me "n8n".

Make it feel like a real client story. Specific numbers. Short punchy sentences. No corporate language.`
  },
  {
    id: "parliament-to-ai",
    playbookId: "ai-operations-hub",
    topic: "Government ops → AI systems thinking",
    prompt: `Write a LinkedIn post. The story: Kirill ran operations for national electoral campaigns at Ukraine's parliament for 5.5 years. The stakes: a single data leak ends careers. The lesson: systems either work perfectly or they don't. He now applies that same zero-tolerance thinking to building AI automation systems for founders. One client example: cut 3.5 hours/day of manual work using n8n + Notion + AI. CTA: "What's eating 3+ hours of your day?"

This should be the most powerful positioning post. The parliament story is the hook. Keep it humble but undeniably credible.`
  },
  {
    id: "local-ai-calgary",
    playbookId: "local-llm-server",
    topic: "Local AI server for Calgary businesses",
    prompt: `Write a LinkedIn post. The scenario: a Calgary law firm needed AI for contract analysis but could not send client data to OpenAI (NDA + PIPEDA compliance). Kirill deployed a local LLaMA server on their hardware. Now they process 200+ contracts/week. Data never leaves their office. Setup cost: $8,500 one-time. Monthly cloud AI they were considering: $2,000+. ROI in under 5 months. CTA: "Are you in oil & gas, legal, or healthcare in Calgary? Let's talk."

Local angle matters. Calgary = energy sector. Data compliance = real concern.`
  },
  {
    id: "founder-ops-waste",
    playbookId: "ai-operations-hub",
    topic: "Founders wasting hours on manual ops",
    prompt: `Write a LinkedIn post. The scenario: Kirill audited a 12-person SaaS company. The founder was spending 4 hours/day on: copying deal data from email to CRM, updating project status in Slack, manually sending weekly reports, chasing team for updates. Kirill built an ops hub with n8n + Notion + AI. Time saved: 3.5 hours/day for the founder. Cost: $4,500. Annual value of founder time recovered at $150/hour: $130,000+. CTA: "I'm taking 2 new ops projects this month. DM me 'ops'."

Very specific numbers. Very clear ROI. Short sentences.`
  },
  {
    id: "ai-vs-hiring",
    playbookId: "ai-operations-hub",
    topic: "Automation vs hiring a new person",
    prompt: `Write a LinkedIn post making the math clear: hiring a junior operations person costs $50,000+/year plus 2-3 months to onboard. Building an AI + n8n automation system costs $3,000-6,000 one-time and handles 80% of the same tasks 24/7. Kirill builds these systems. Reference: in his 5.5 years running parliamentary operations, he learned that smart systems outperform extra headcount every time. CTA: "What tasks are eating your team's time right now?"

This is a mindset shift post. Challenge the default assumption of "hire more people to scale."`
  },
  {
    id: "ai-lead-system",
    playbookId: "ai-lead-generation-system",
    topic: "AI system that finds and researches prospects automatically",
    prompt: `Write a LinkedIn post. The scenario: Kirill built a system for a B2B consulting firm that monitors Reddit, HackerNews, and LinkedIn for buying signals, automatically researches each company (size, tech stack, recent posts), and drafts a personalized outreach message. The founder reviews and sends. Time per prospect went from 45 minutes to under 4 minutes. 18 qualified conversations in the first month. CTA: "What does your current prospecting process look like?"

This post should make B2B founders feel the pain of their current manual process and immediately see the alternative.`
  },
  {
    id: "data-security-post",
    playbookId: "local-llm-server",
    topic: "Most businesses are making a data security mistake with AI",
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

async function generatePost(prompt) {
  return callOpenAI(
    `You are a ghostwriter for Kirill D.. ${KIRILL_PROFILE}

Write a LinkedIn post and return JSON with:
- hook: first sentence (max 8 words, punchy, surprising or contrarian)
- body: main content (150-180 words, short sentences, real numbers, story format)
- cta: last line (soft call to action, max 15 words)
- visualBrief: description for an image (what should it show, style, mood — 2 sentences)
- targetEmotion: what should the reader feel after reading (1 word)
- bestTimeToPost: "morning" or "midday" or "evening"`,
    prompt.prompt
  );
}

async function generateProposal(playbookId, clientContext = "") {
  const playbook = playbooks.find(p => p.id === playbookId);
  if (!playbook) return null;

  return callOpenAI(
    `You are helping Kirill D. respond to a potential client inquiry. ${KIRILL_PROFILE}

Based on the service playbook provided, write a concise commercial proposal.
Return JSON with:
- subject: email subject line
- greeting: 2-sentence opener that shows you understand their problem
- whatWeDeliver: 3-4 bullet points of specific deliverables
- howLong: timeline sentence
- investment: pricing range sentence (be specific, not vague)
- nextStep: one clear action to take (e.g., "15-minute discovery call")
- ps: one sentence that builds trust (reference experience or specific result)`,
    `Service: ${playbook.title}
Playbook: ${JSON.stringify(playbook, null, 2)}
Client context: ${clientContext || "General inquiry from LinkedIn post"}`
  );
}

async function generateImageWithDallE(visualBrief, postId) {
  if (!OPENAI_API_KEY) {
    return { status: "skipped", reason: "OPENAI_API_KEY not configured in .env" };
  }

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
      return { status: "failed", error: JSON.stringify(data).slice(0, 200) };
    }
    const imgRes = await fetch(data.data[0].url);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const fs = await import("fs/promises");
    const imgPath = resolve(__dirname, `../.data/images/${postId}.png`);
    await fs.mkdir(resolve(__dirname, "../.data/images"), { recursive: true });
    await fs.writeFile(imgPath, imgBuffer);
    return { status: "generated", path: imgPath };
  } catch (err) {
    return { status: "failed", error: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const singlePost = args[0]; // optional: run single post by id

  const targetPrompts = singlePost
    ? POST_PROMPTS.filter(p => p.id === singlePost)
    : POST_PROMPTS;

  console.log(`\n🚀 LinkedIn Brand OS — Content Engine`);
  console.log(`Generating ${targetPrompts.length} posts with full backing...\n`);

  const results = [];

  for (const prompt of targetPrompts) {
    process.stdout.write(`📝 ${prompt.topic}... `);
    try {
      const [post, proposal] = await Promise.all([
        generatePost(prompt),
        generateProposal(prompt.playbookId)
      ]);

      const image = await generateImageWithDallE(post.visualBrief || "", prompt.id);
      const playbook = playbooks.find(p => p.id === prompt.playbookId);

      const result = {
        id: prompt.id,
        playbookId: prompt.playbookId,
        generatedAt: new Date().toISOString(),
        post: {
          hook: post.hook,
          body: post.body,
          cta: post.cta,
          fullText: `${post.hook}\n\n${post.body}\n\n${post.cta}`,
          targetEmotion: post.targetEmotion,
          bestTimeToPost: post.bestTimeToPost,
          visualBrief: post.visualBrief
        },
        image,
        implementation: {
          service: playbook?.title,
          tagline: playbook?.tagline,
          timeline: playbook?.implementation?.totalDays,
          pricing: playbook?.pricing,
          techStack: playbook?.techStack,
          phases: playbook?.implementation?.phases,
          caseStudyTemplate: playbook?.caseStudyTemplate,
          commonChallenges: playbook?.commonChallenges,
          successMetrics: playbook?.successMetrics
        },
        commercialProposal: proposal
      };

      results.push(result);
      console.log(`✅`);
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  // Save full results
  const fs = await import("fs/promises");
  const outputPath = resolve(__dirname, "../.data/kirill-posts.json");
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));

  // Print readable summary
  console.log("\n" + "═".repeat(70));
  console.log("POSTS READY FOR PUBLICATION");
  console.log("═".repeat(70));

  for (const r of results) {
    console.log(`\n📌 ${r.id.toUpperCase()}`);
    console.log("─".repeat(50));
    console.log(r.post.fullText);
    console.log(`\n🎨 Visual: ${r.post.visualBrief}`);
    console.log(`🖼  Image: ${r.image?.status === "generated" ? r.image.path : r.image?.reason || "not generated"}`);
    console.log(`⏰ Post at: ${r.post.bestTimeToPost}`);
    console.log(`\n💼 SERVICE: ${r.implementation.service}`);
    console.log(`   Timeline: ${r.implementation.timeline}`);
    const prices = r.implementation.pricing;
    if (prices) {
      const entries = Object.entries(prices).filter(([k]) => k !== "retainer");
      console.log(`   Pricing: ${entries.map(([k,v]) => `${k}: $${v.price}`).join(" | ")}`);
    }
    if (r.commercialProposal) {
      console.log(`\n📧 PROPOSAL READY:`);
      console.log(`   Subject: ${r.commercialProposal.subject}`);
      console.log(`   Next step: ${r.commercialProposal.nextStep}`);
    }
    console.log("");
  }

  console.log(`\n💾 Full data saved to .data/kirill-posts.json`);
  console.log(`   Each post includes: full text + visual brief + implementation guide + commercial proposal`);
  console.log(`\n📅 PUBLISHING SCHEDULE:`);
  results.forEach((r, i) => {
    const dates = ["Mar 26", "Mar 28", "Mar 30", "Apr 1", "Apr 3", "Apr 5", "Apr 7"];
    console.log(`   ${dates[i] || `Day ${(i+1)*2}`} 9:00 AM Calgary — ${r.id}`);
  });
}

main().catch(console.error);
