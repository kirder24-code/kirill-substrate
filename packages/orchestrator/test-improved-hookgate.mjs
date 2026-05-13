import { OrchestratorService } from "./packages/orchestrator/dist/index.js";

async function testImprovedHookGate() {
  console.log("=== TESTING IMPROVED HOOK GATE ===\n");

  const orchestrator = new OrchestratorService({
    enableAutonomousAiDrafts: true
  });

  const workItems = (await orchestrator.listAutonomousContentWorkItems())
    .filter(w => w.reviewState === "saved")
    .slice(27, 32);

  console.log(`Generating 5 fresh drafts...\n`);

  const drafts = [];

  for (let i = 0; i < workItems.length; i++) {
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

  console.log("\n\n" + "=".repeat(80));
  console.log("FINAL DRAFT REVIEW");
  console.log("=".repeat(80) + "\n");

  let publishWorthy = 0;
  let hookValid = 0;
  let hookStrong = 0;

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    
    const lines = draft.body.split('\n\n').filter(l => l.trim());
    const hook = lines[0] || "";
    
    // Hook validity checks
    const words = hook.split(/\s+/);
    const lastWord = words[words.length - 1]?.toLowerCase().replace(/[^\w]/g, "");
    const weakEndings = ["a", "an", "the", "when", "with", "without", "because", "that", "as", "for", "to", "of", "in"];
    
    const endsWithWeakWord = lastWord && weakEndings.includes(lastWord);
    const hasPunctuation = /[.!?]$/.test(hook);
    const goodLength = hook.length >= 20 && hook.length <= 100;
    const looksComplete = words.length >= 5 && !/(one|simple|clearly|usually)\s*$/.test(hook);
    
    const isHookValid = !endsWithWeakWord && goodLength && looksComplete;
    const isHookStrong = isHookValid && (hasPunctuation || hook.includes('?'));
    
    if (isHookValid) hookValid++;
    if (isHookStrong) hookStrong++;
    
    // Overall quality
    const hasLeakage = 
      draft.body.includes("Focus on the") || 
      draft.body.includes("Keep the language grounded");
    
    const hasForcedPattern = 
      draft.body.includes("The real breakdown starts when") ||
      draft.body.includes("Most teams miss the operating system around it");
    
    const coherent = lines.length >= 2 && lines.every(l => l.length > 15);
    const businessFocused = /\b(operator|business|workflow|approval|owner|team|execution|rollout|decision|deploy)\b/i.test(draft.body);
    
    const isPublishWorthy = 
      !hasLeakage && 
      !hasForcedPattern && 
      isHookValid && 
      coherent && 
      businessFocused;
    
    if (isPublishWorthy) publishWorthy++;
    
    console.log(`DRAFT ${i + 1}/${drafts.length}: ${draft.id}`);
    console.log("-".repeat(80));
    console.log(`Hook: "${hook}"`);
    console.log("");
    console.log(draft.body);
    console.log("-".repeat(80));
    console.log(`Hook valid: ${isHookValid ? "YES ✓" : "NO ✗"} ${!looksComplete ? "(incomplete thought)" : endsWithWeakWord ? `(ends with "${lastWord}")` : ""}`);
    console.log(`Hook strong: ${isHookStrong ? "YES ✓" : "NO ✗"}`);
    console.log(`Coherent: ${coherent ? "YES ✓" : "NO ✗"}`);
    console.log(`Business-focused: ${businessFocused ? "YES ✓" : "NO ✗"}`);
    console.log(`Leakage: ${hasLeakage ? "YES ✗" : "NO ✓"}`);
    console.log(`Forced pattern: ${hasForcedPattern ? "YES ✗" : "NO ✓"}`);
    console.log(`PUBLISH-WORTHY: ${isPublishWorthy ? "YES ✓✓✓" : "NO"}`);
    console.log("=".repeat(80) + "\n");
  }

  console.log("\n" + "=".repeat(80));
  console.log("CONSISTENCY RESULT");
  console.log("=".repeat(80));
  console.log(`Total drafts: ${drafts.length}`);
  console.log(`Hook valid: ${hookValid}/${drafts.length} (${Math.round(hookValid/drafts.length*100)}%)`);
  console.log(`Hook strong: ${hookStrong}/${drafts.length} (${Math.round(hookStrong/drafts.length*100)}%)`);
  console.log(`Publish-worthy: ${publishWorthy}/${drafts.length} (${Math.round(publishWorthy/drafts.length*100)}%)\n`);
  
  const consistency = Math.round(publishWorthy/drafts.length*100);
  
  if (consistency >= 80) {
    console.log("✓ EXCELLENT: Hook gate is working, consistency at acceptance level");
  } else if (consistency >= 60) {
    console.log("✓ GOOD: Materially improved from baseline");
  } else {
    console.log("✗ NEEDS WORK: Below acceptance threshold");
  }
  console.log("=".repeat(80) + "\n");

  process.exit(0);
}

testImprovedHookGate().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
