export type {
  PersonaTree,
  DomainNode,
  ConfidenceValue,
  CommunicationStyle,
  TopicBandit,
  FeedbackProfile,
  RapportMetrics,
  SentimentResult,
} from "../types.js";

/** Extracted attribute with dot-path field, 0-1 confidence, and evidence text */
export type ExtractedAttribute = {
  field: string;
  value: string;
  confidence: number;
  source: "explicit" | "inferred" | "observed";
  evidence: string;
};

/** Structured result from a persona extraction pass */
export type ExtractionResult = {
  attributes: ExtractedAttribute[];
  domains: Array<{
    name: string;
    depth: number;
    insights: string[];
    questions: string[];
    negated?: boolean;
  }>;
  recentFocus: string[];
  pendingQuestions: string[];
  sentiment?: import("../types.js").SentimentResult;
};
