import type { PersonaTree, UserLifecycleStage } from "../types.js";

/**
 * Build a concise persona context section for system prompt injection.
 * This is NOT the full persona — just what the agent needs to know right now.
 */
export function buildPersonaContext(persona: PersonaTree | undefined): string {
  if (!persona) return "";

  const lines: string[] = ["## User Cognitive Profile"];

  // Identity (only high-confidence traits)
  const traits = Object.entries(persona.identity.coreTraits)
    .filter(([, v]) => v.confidence >= 0.5)
    .map(([k, v]) => `${k}: ${v.value} (${Math.round(v.confidence * 100)}%)`);
  if (traits.length > 0) {
    lines.push("### Known Traits");
    lines.push(...traits);
  }

  // Domains of expertise/interest
  const expertDomains = persona.identity.expertDomains;
  const interestDomains = persona.identity.interestDomains;
  if (expertDomains.length > 0 || interestDomains.length > 0) {
    lines.push("### Domain Profile");
    if (expertDomains.length > 0) lines.push(`Expert: ${expertDomains.join(", ")}`);
    if (interestDomains.length > 0) lines.push(`Interested: ${interestDomains.join(", ")}`);
  }

  // Active domains (recently mentioned)
  const activeDomains = Object.entries(persona.domains)
    .filter(([, d]) => d.depth >= 3)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned)
    .slice(0, 5)
    .map(([name, d]) => `${name} (depth: ${d.depth})`);
  if (activeDomains.length > 0) {
    lines.push("### Active Topics");
    lines.push(...activeDomains);
  }

  // Recent focus
  if (persona.recentFocus.length > 0) {
    lines.push("### Recent Focus");
    lines.push(persona.recentFocus.slice(0, 5).join(", "));
  }

  // Trust level indicator (subtle, for agent behavior adaptation)
  const trust = persona.rapport.trustScore;
  if (trust >= 0.7) {
    lines.push("### Interaction Note");
    lines.push("User has established rapport. Proactive suggestions are welcome.");
  } else if (trust >= 0.4) {
    lines.push("### Interaction Note");
    lines.push("Building rapport. Be helpful first, curious second.");
  }

  const latestMood = persona.moodHistory?.slice(-1)[0];
  if (latestMood?.sentiment.label === "frustrated") {
    lines.push("### Mood Note");
    lines.push("User may be frustrated. Be patient, concise, and solution-focused.");
  } else if (latestMood?.sentiment.label === "confused") {
    lines.push("### Mood Note");
    lines.push("User seems uncertain. Prefer clear explanations with examples.");
  } else if (latestMood?.sentiment.label === "excited") {
    lines.push("### Mood Note");
    lines.push("User is enthusiastic. Match their energy; explore the topic together.");
  }

  if (persona.domainBlacklist && persona.domainBlacklist.length > 0) {
    lines.push("### Blacklisted Topics");
    lines.push(`Never proactively suggest: ${persona.domainBlacklist.join(", ")}`);
  }

  if (persona.lifecycle.stage !== "active") {
    const stageLabels: Record<UserLifecycleStage, string> = {
      new: "New user — be conservative with proactive suggestions",
      dormant: "Dormant user — re-engagement appropriate",
      lapsed: "Lapsed user — minimal outreach",
      active: "",
    };
    lines.push("### Lifecycle Note");
    lines.push(stageLabels[persona.lifecycle.stage]);
  }

  if (persona.identity.communicationStyle) {
    const cs = persona.identity.communicationStyle;
    lines.push("### Communication Style");
    lines.push(`Formality: ${cs.formality}, Verbosity: ${cs.verbosity}, Technical: ${cs.technicalLevel}, Language: ${cs.preferredLanguage}`);
  }

  return lines.join("\n");
}
