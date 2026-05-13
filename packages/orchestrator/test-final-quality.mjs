import { OrchestratorService } from "./packages/orchestrator/dist/index.js";

async function testFinalQuality() {
  console.log("=== FINAL QUALITY TEST (NO FORCED PATTERNS) ===\n");

  const orchestrator = new OrchestratorService({
    enableAutonomousAiDrafts: true
  });

  const workItems = (await orchestrator.listAutonomousContentWorkItems())
    .filter(w => w.reviewState === "saved")
    .slice(17, 22);

  console.log(`Generating ${Math.min(5, workItems.length)} drafts without forced patterns...\n`);

  const drafts = [];

  for (let i = 0; i < Math.min(5, workItems.length); i++) {
    const workItem = workItems[i];
    console.log(`[${i + 1}] ${workItem.id}...`);

    try {
      const draft = await orchestrator.createAutonomousDraftWithAiGeneration(workItem.id);
      if (draft) {
        drafts.push(draft);
        console.log(`  ✓ ${draft.id}`);
      }
    } catch (error) {
      console.log(`  ✗ ${error.message}`);
    }
  }

  console.log("\n\n=== DRAFT QUALITY ASSESSMENT ===\n");

  let publishWorthy = 0;

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    
    // Quality checks
    const hasLeakage = 
      draft.body.includes("Focus on the") || 
      draft.body.includes("Keep the language grounded") ||
      draft.body.includes("The point is practical");
    
    const hasForcedPattern = 
      draft.body.includes("The real breakdown starts when") ||
      draft.body.includes("Most teams miss the operating system around it");
    
    const lines = draft.body.split('\n\n').filter(l => l.trim());
    const hook = lines[0] || "";
    const hookComplete = hook.length > 20 && !/\s(a|an|when|with|without|because)\s*$/.test(hook);
    const hookStrong = /^\w+/.test(hook) && hook.length < 80;
    
    const coherent = lines.length >= 2 && lines.every(l => l.length > 10);
    const businessFocused = /\b(operator|business|workflow|approval|owner|team|execution|rollout|decision)\b/i.test(draft.body);
    
    const isPublishWorthy = 
      !hasLeakage && 
      !hasForcedPattern && 
      hookComplete && 
      hookStrong && 
      coherent && 
      businessFocused;
    
    if (isPublishWorthy) publishWorthy++;
    
    console.log(`━━━ DRAFT ${i + 1}: ${draft.id} ${isPublishWorthy ? "✓ PUBLISH-WORTHY" : "✗ NEEDS WORK"} ━━━`);
    console.log(`\n${draft.body}\n`);
    console.log(`${"─".repeat(70)}`);
    console.log(`✓ No leakage: ${!hasLeakage ? "YES" : "NO"}`);
    console.log(`✓ Natural flow: ${!hasForcedPattern ? "YES" : "NO"}`);
    console.log(`✓ Complete hook: ${hookComplete ? "YES" : "NO"}`);
    console.log(`✓ Strong hook: ${hookStrong ? "YES" : "NO"}`);
    console.log(`✓ Coherent: ${coherent ? "YES" : "NO"}`);
    console.log(`✓ Business-focused: ${businessFocused ? "YES" : "NO"}`);
    console.log(`${"═".repeat(70)}\n`);
  }

  console.log(`\n=== FINAL VERDICT ===`);
  console.log(`Total drafts: ${drafts.length}`);
  console.log(`Publish-worthy: ${publishWorthy}/${drafts.length} (${Math.round(publishWorthy/drafts.length*100)}%)`);
  
  if (publishWorthy >= Math.ceil(drafts.length * 0.6)) {
    console.log(`\n✓ PASS: Majority of drafts are materially improved and closer to publish-worthy.\n`);
  } else {
    console.log(`\n✗ FAIL: Quality still needs improvement.\n`);
  }

  process.exit(0);
}

testFinalQuality().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
