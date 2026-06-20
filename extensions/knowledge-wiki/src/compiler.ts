import type { ExtractionResult, ExtractedClaim, ExtractedEntity, ExtractedConcept } from "./types.js";

export type GenerateTextFn = (prompt: string) => Promise<string>;

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge compiler. Read the source document and extract structured knowledge.

Return a JSON object with this exact shape:
{
  "summary": "2-3 paragraph summary of key points",
  "claims": [{ "text": "specific factual assertion", "confidence": 0.0-1.0, "category": "domain_knowledge|technical_decision|stated_preference|process|constraint|contextual_fact|goal_or_aspiration", "evidence": "quote or paraphrase from source" }],
  "entities": [{ "name": "named thing", "type": "person|tool|project|technology|place|organization|concept", "description": "what it is in context" }],
  "concepts": [{ "name": "abstract idea or methodology", "description": "explanation", "relatedTo": ["other concept names"] }],
  "topics": ["subject area tags"],
  "relationships": [{ "from": "entity/concept name", "to": "entity/concept name", "type": "uses|contradicts|relates-to|depends-on|part-of" }]
}

Rules:
- Extract only what is explicitly stated or directly implied in the document
- Confidence: 0.9+ for explicit statements, 0.7-0.9 for strong implications, 0.5-0.7 for weak implications
- Keep claim text concise (one sentence)
- Entity names should be proper nouns or well-known terms
- Return ONLY the JSON, no markdown fences, no commentary`;

export async function extractFromSource(
  generateText: GenerateTextFn,
  content: string,
  sourceMeta: { readonly path: string; readonly filename: string },
): Promise<ExtractionResult> {
  const truncatedContent = content.length > 12000
    ? `${content.slice(0, 12000)}\n\n[... truncated, ${content.length} total chars ...]`
    : content;

  const prompt = `${EXTRACTION_SYSTEM_PROMPT}

Source file: ${sourceMeta.filename}
Path: ${sourceMeta.path}

---
${truncatedContent}
---

Extract the knowledge as JSON:`;

  const response = await generateText(prompt);
  return parseExtractionResult(response);
}

function parseExtractionResult(response: string): ExtractionResult {
  const jsonStr = extractJsonFromResponse(response);
  if (!jsonStr) {
    return createEmptyExtraction();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return createEmptyExtraction();
  }

  if (typeof parsed !== "object" || parsed === null) {
    return createEmptyExtraction();
  }

  const obj = parsed as Record<string, unknown>;

  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const claims = parseClaims(obj.claims);
  const entities = parseEntities(obj.entities);
  const concepts = parseConcepts(obj.concepts);
  const topics = parseTopics(obj.topics);
  const relationships = parseRelationships(obj.relationships);

  return { summary, claims, entities, concepts, topics, relationships };
}

function extractJsonFromResponse(response: string): string | null {
  const trimmed = response.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }

  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    return trimmed.slice(jsonStart, jsonEnd + 1);
  }

  return null;
}

function createEmptyExtraction(): ExtractionResult {
  return {
    summary: "",
    claims: [],
    entities: [],
    concepts: [],
    topics: [],
    relationships: [],
  };
}

function parseClaims(raw: unknown): ExtractedClaim[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const claims: ExtractedClaim[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) {
      continue;
    }
    const confidence = typeof obj.confidence === "number"
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0.5;
    const category = typeof obj.category === "string" ? obj.category : "domain_knowledge";
    const evidence = typeof obj.evidence === "string" ? obj.evidence : undefined;
    claims.push({ text, confidence, category, ...(evidence ? { evidence } : {}) });
  }
  return claims;
}

function parseEntities(raw: unknown): ExtractedEntity[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const entities: ExtractedEntity[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) {
      continue;
    }
    const type = typeof obj.type === "string" ? obj.type : "concept";
    const description = typeof obj.description === "string" ? obj.description : "";
    entities.push({ name, type, description });
  }
  return entities;
}

function parseConcepts(raw: unknown): ExtractedConcept[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const concepts: ExtractedConcept[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) {
      continue;
    }
    const description = typeof obj.description === "string" ? obj.description : "";
    const relatedTo = Array.isArray(obj.relatedTo)
      ? obj.relatedTo.filter((r): r is string => typeof r === "string")
      : undefined;
    concepts.push({ name, description, ...(relatedTo ? { relatedTo } : {}) });
  }
  return concepts;
}

function parseTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

function parseRelationships(
  raw: unknown,
): ExtractionResult["relationships"] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const relationships: Array<{ from: string; to: string; type: string }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const from = typeof obj.from === "string" ? obj.from : "";
    const to = typeof obj.to === "string" ? obj.to : "";
    const type = typeof obj.type === "string" ? obj.type : "relates-to";
    if (from && to) {
      relationships.push({ from, to, type });
    }
  }
  return relationships;
}
