export async function chat(request) {
  const task = request?.task ?? "unknown";
  const prompt = typeof request?.prompt === "string" ? request.prompt : "";

  if (task === "generatePostFromIdea") {
    return {
      text: "Operational posts land better when the rollout owner is explicit.",
      hook: "Operational AI rollout needs an owner",
      body: "Operational posts land better when the rollout owner is explicit and the delivery steps are practical.",
      cta: "Compare notes if your team is working through the same rollout friction."
    };
  }

  if (task === "refinePostDraft") {
    return `Teams need clearer rollout ownership and less vague planning. Keep the language practical and grounded.`;
  }

  throw new Error(`Unsupported task '${task}' for test mirai chat module.`);
}
