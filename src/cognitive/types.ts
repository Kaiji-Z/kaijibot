// Conversation mode — determines agent behavior
export type CognitiveMode = "task" | "insight" | "hybrid" | "proactive";

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
  activeQuestions: string[];
  connections: string[];
  negationSignals: number;
  lastNegatedAt?: number;
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
  preferredStyle: "question" | "observation" | "connection";
  optimalFrequencyHours: number;
  lastProactiveAt: number;
  suppressUntil?: number;
  recentInsightIds: string[];
};

// Trust/rapport metrics
export type RapportMetrics = {
  trustScore: number;
  totalExchanges: number;
  avgResponseLength: number;
  selfDisclosureLevel: number;
};

// The full user cognitive model (PersonaTree)
export type PersonaTree = {
  identity: {
    coreTraits: Record<string, ConfidenceValue>;
    communicationStyle?: CommunicationStyle;
    timezone?: string;
    primaryLanguage?: string;
    expertDomains: string[];
    interestDomains: string[];
    curiosityDomains: string[];
    userId?: string; // channel-specific user ID for traceability
  };
  domains: Record<string, DomainNode>;
  recentFocus: string[];
  activeProjects: string[];
  pendingQuestions: string[];
  feedbackProfile: FeedbackProfile;
  rapport: RapportMetrics;
  domainGraph?: LearnedDomainGraph;
  moodHistory: MoodSnapshot[];
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
};
