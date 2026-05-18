// Conversation mode — determines agent behavior
export type CognitiveMode = "task" | "insight" | "hybrid" | "proactive";

/**
 * Category of a typed insight extracted from user interactions.
 * Used to classify and filter insights for downstream consumers.
 *
 * - domain_knowledge: Factual knowledge the user has about a domain
 * - behavioral_pattern: Repeated behaviors or thinking patterns observed
 * - stated_preference: Explicit preferences the user has expressed
 * - tool_config: Configuration/usage of tools (excluded from insight prompts)
 * - contextual_fact: Situational facts (e.g. "currently at work") — short-lived
 * - goal_or_aspiration: Long-term goals or aspirations the user mentioned
 */
export type InsightCategory =
  | "domain_knowledge"
  | "behavioral_pattern"
  | "stated_preference"
  | "tool_config"
  | "contextual_fact"
  | "goal_or_aspiration";

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
export type InterestPhase =
  | "emergent"
  | "stable"
  | "declining"
  | "dormant"
  | "revived";

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

export type SentimentLabel = "positive" | "negative" | "neutral" | "frustrated" | "excited" | "confused";

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
  domainGraph?: LearnedDomainGraph;
  moodHistory: MoodSnapshot[];
  domainBlacklist: string[];
  lifecycle: UserLifecycle;
  calibrationHistory: CalibrationRecord[];
};

// Weighted edge in a learned domain co-occurrence graph
export type DomainGraphEdge = {
  source: string;
  target: string;
  weight: number;
  lastObserved: number; // timestamp ms
  observations: number;
};

// Learned domain co-occurrence graph (persisted alongside PersonaTree)
export type LearnedDomainGraph = {
  nodes: string[];
  edges: DomainGraphEdge[];
  totalObservations: number;
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
  promptVariant?: {
    fewShotSet: number;
    frameIndex: number;
    structureSeed?: number;
    patternFrame?: number;
  };
};
