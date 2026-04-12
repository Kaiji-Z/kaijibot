/** Explicit feedback from user on an insight */
export type FeedbackEvent = {
  /** The insight or message this feedback refers to */
  targetId: string;
  /** Feedback type */
  type: "positive" | "negative" | "neutral" | "engaged";
  /** How the feedback was given */
  mechanism: "emoji" | "button" | "text" | "implicit";
  /** The topic/domain this feedback relates to */
  topic?: string;
  /** Timestamp */
  timestamp: number;
  /** Optional text response */
  textResponse?: string;
  /** How long the user took to respond (ms) — engagement signal */
  responseLatencyMs?: number;
};

/** Implicit feedback signal derived from user behavior */
export type ImplicitFeedbackSignal = {
  type: "response_length" | "response_latency" | "topic_continuation" | "topic_abandonment" | "question_depth";
  topic?: string;
  value: number;
  timestamp: number;
};

/** Aggregated feedback for a topic */
export type TopicFeedbackSummary = {
  topic: string;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  engagedCount: number;
  lastFeedbackAt: number;
  /** Thompson Sampling posterior — higher = more likely to push this topic */
  samplingScore: number;
};
