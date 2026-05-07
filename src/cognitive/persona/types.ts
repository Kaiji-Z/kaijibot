import type { InsightCategory as InsightCategoryBase, SentimentResult as SentimentResultBase, CommunicationStyle as CommunicationStyleBase } from "../types.js";

export type {
  PersonaTree,
  DomainNode,
  ConfidenceValue,
  CommunicationStyle,
  TopicBandit,
  FeedbackProfile,
  RapportMetrics,
  SentimentResult,
  TypedInsight,
  InsightCategory,
} from "../types.js";

export type ExtractedAttribute = {
  field: string;
  value: string;
  confidence: number;
  source: "explicit" | "inferred" | "observed";
  evidence: string;
};

export type ExtractedInsight = {
  text: string;
  category: InsightCategoryBase;
  confidence: number;
  source: "explicit" | "inferred" | "observed";
};

export type ExtractionResult = {
  attributes: ExtractedAttribute[];
  domains: Array<{
    name: string;
    depth: number;
    insights: string[];
    /** Typed insights from LLM extraction with category metadata. */
    typedInsights?: ExtractedInsight[];
    questions: string[];
    negated?: boolean;
  }>;
  recentFocus: string[];
  blacklistRequests?: string[];
  sentiment?: SentimentResultBase;
  communicationStyle?: CommunicationStyleBase;
};
