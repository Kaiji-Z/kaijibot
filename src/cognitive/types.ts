import type { InsightCandidate, InsightMode } from "./insight/types.js";

// Conversation mode — determines agent behavior
export type CognitiveMode = "task" | "insight" | "hybrid" | "proactive";

/**
 * Category of a typed insight extracted from user interactions.
 * Used to classify and filter insights for downstream consumers.
 *
 * - durable: Long-lasting knowledge, preferences, behaviors, or goals
 * - ephemeral: Short-lived facts, tool configs, current context (excluded from insight prompts)
 */
export type InsightCategory = "durable" | "ephemeral";

export type TypedInsight = {
  text: string;
  category: InsightCategory;
  confidence: number;
  source: "explicit" | "inferred" | "observed";
  firstObserved: number;
  lastReinforced: number;
  evidenceCount: number;
  halfLifeDays: number;
};

/** Lifecycle phase of a user's interest in a domain. */
export type InterestPhase = "emergent" | "stable" | "declining" | "dormant" | "revived";

// Result from mode classification
export type ModeClassification = {
  mode: CognitiveMode;
  confidence: number; // 0-1
  signals: string[]; // what signals informed the decision
};

// Communication style inferred from user
export type CommunicationStyle = {
  formality: "formal" | "casual" | "mixed";
  verbosity: "concise" | "moderate" | "detailed";
  technicalLevel: "beginner" | "intermediate" | "expert";
  preferredLanguage: "zh" | "en" | "mixed";
};

// Confidence-weighted attribute
export type ConfidenceValue<T = string> = {
  value: T;
  confidence: number;
  evidenceCount: number;
  lastUpdated: number; // timestamp
  source: "explicit" | "inferred" | "observed";
};

// Per-domain user engagement
export type DomainNode = {
  depth: number;
  recurrence: number;
  lastMentioned: number;
  keyInsights: string[];
  /** Typed insights with category, confidence, and decay metadata. */
  insights?: TypedInsight[];
  activeQuestions: string[];
  negationSignals: number;
  lastNegatedAt?: number;
  /** Current lifecycle phase of user interest in this domain. */
  phase?: InterestPhase;
  /** Timestamp when the current phase was entered. */
  phaseEnteredAt?: number;
};

// Thompson Sampling arm for a topic
export type TopicBandit = {
  alpha: number;
  beta: number;
  lastUpdated?: number;
};

export type SentimentLabel =
  | "positive"
  | "negative"
  | "neutral"
  | "frustrated"
  | "excited"
  | "confused";

export type SentimentResult = {
  label: SentimentLabel;
  confidence: number;
  evidence: string;
};

export type MoodSnapshot = {
  sentiment: SentimentResult;
  timestamp: number;
  trend: "improving" | "stable" | "declining";
};

// User's feedback profile
export type FeedbackProfile = {
  topicBandits: Record<string, TopicBandit>;
  optimalFrequencyHours: number;
  lastProactiveAt: number;
  suppressUntil?: number;
  recentInsightIds: string[];
  recentInsightContents: string[];
  recentInsightDomains?: string[][];
  recentInsightTypes?: string[];
  recentInsightQueryHistory?: string[];
  promptBandits?: Record<string, TopicBandit>;
  /** Thompson Sampling arms for insight modes (knowledge/pattern/surprise/extend). */
  modeBandits?: Record<string, TopicBandit>;
  /** Consecutive proactive messages with no user response (for backoff calculation). */
  consecutiveNoResponses?: number;
  /** Last 5 insight modes (knowledge/pattern/surprise/extend) for no-response tracking. */
  recentInsightModes?: string[];
  /**
   * Timestamp of the last proactive message that was penalized as no-response.
   * Used to ensure processNoResponse fires at most once per delivered insight.
   * Set to the lastProactiveAt value when the penalty was applied.
   */
  lastNoResponseAt?: number;
  /**
   * Insight generated but not yet delivered. Retried on every scheduler event
   * (bypassing gate and LLM) until delivery succeeds or it expires (24h).
   * Persists to persona file so it survives gateway restarts.
   */
  pendingInsightDelivery?: {
    candidate: InsightCandidate;
    generatedAt: number;
    opportunityType: string;
  } | null;
};

// Trust/rapport metrics
export type RapportMetrics = {
  trustScore: number;
  totalExchanges: number;
  avgResponseLength: number;
  selfDisclosureLevel: number;
};

// User lifecycle stage
export type UserLifecycleStage = "new" | "active" | "dormant" | "lapsed";

export type UserLifecycle = {
  stage: UserLifecycleStage;
  lastActiveAt: number;
  lastStageTransitionAt: number;
  totalActiveDays: number;
};

// Calibration record
export type CalibrationRecord = {
  insightId: string;
  predictedPAccept: number;
  actualOutcome: "positive" | "negative" | "neutral" | "engaged" | "no_response";
  timestamp: number;
};

// Contradiction log
export type ContradictionStatus = "resolved_new" | "resolved_old" | "resolved_merge";

export type ContradictionRecord = {
  field: string;
  oldValue: string;
  newValue: string;
  oldConfidence: number;
  newConfidence: number;
  oldSource: "explicit" | "inferred" | "observed";
  newSource: "explicit" | "inferred" | "observed";
  resolution: ContradictionStatus;
  resolvedAt: number;
};

// The full user cognitive model (PersonaTree)
export type PersonaTree = {
  identity: {
    displayName?: string;
    coreTraits: Record<string, ConfidenceValue>;
    communicationStyle?: CommunicationStyle;
    primaryLanguage?: string;
    expertDomains: string[];
    interestDomains: string[];
    curiosityDomains: string[];
    userId?: string; // channel-specific user ID for traceability
  };
  domains: Record<string, DomainNode>;
  recentFocus: string[];
  feedbackProfile: FeedbackProfile;
  rapport: RapportMetrics;
  moodHistory: MoodSnapshot[];
  domainBlacklist: string[];
  lifecycle: UserLifecycle;
  calibrationHistory: CalibrationRecord[];
};

// Insight record for proactive suggestions
export type InsightRecord = {
  id: string;
  generatedAt: number;
  triggerSource: "scheduled" | "event" | "conversational";
  targetDomains: string[];
  sourceDomains: string[];
  content: string;
  rationale: string;
  sources: Array<{ url: string; title: string; credibility: number }>;
  feedback?: "positive" | "negative" | "neutral" | "engaged";
  deliveredAt?: number;
  userResponse?: string;
  /** Channel-native message id assigned to the delivered insight (for reply matching). */
  deliveryMessageId?: string;
  /** Resolved insight mode at generation time — used to reconstruct pendingInsightDelivery. */
  resolvedMode?: InsightMode;
  promptVariant?: {
    fewShotSet: number;
    frameIndex: number;
    structureSeed?: number;
    patternFrame?: number;
  };
};
