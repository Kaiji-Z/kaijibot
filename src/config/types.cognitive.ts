export type CognitiveConfig = {
  /** Enable cognitive layer (default: true) */
  enabled?: boolean;
  /** Proactive behavior settings */
  proactive?: {
    /** Allow proactive pushes (default: true) */
    enabled?: boolean;
    /** Minimum interval between proactive pushes in hours (default: 4) */
    minIntervalHours?: number;
    /** Active hours window */
    activeHours?: {
      start?: string;
      end?: string;
      timezone?: string;
    };
    /** Digest mode for proactive insights */
    digestMode?: "realtime" | "daily" | "weekly";
  };
  /** User cognitive model settings */
  persona?: {
    /** Auto-extract user profile from conversations (default: true) */
    autoExtract?: boolean;
    /** Lightweight model for extraction (default: uses main model) */
    extractionModel?: string;
    /** L1 identity memory refresh interval in hours (default: 24) */
    identityRefreshHours?: number;
  };
  /** Insight engine settings */
  insight?: {
    /** Information source settings */
    sources?: {
      /** Web search provider */
      webSearchProvider?: string;
      /** Scan interval in hours (default: 6) */
      scanIntervalHours?: number;
      /** Explicit topics to track (also auto-inferred from persona) */
      explicitTopics?: string[];
    };
    /** Fact verification strictness */
    verificationLevel?: "basic" | "strict" | "paranoid";
    /** Insight engine version (default: v1) */
    engine?: "v1" | "v2" | "dual" | "knowledge" | "pattern" | "unified";
    /** Model used for interest inference and insight generation (default: uses main model). */
    inferenceModel?: string;
    /** Ratio of surprise-mode insights vs extend-mode (0-1, default 0.8 = 80% surprise). */
    surpriseRatio?: number;
    /** Ratio of pattern-mode (behavioral) vs knowledge-mode insights (0-1, default 0.5). */
    patternModeRatio?: number;
    /** Output language for generated insights (default: "zh"). Auto-detected from persona if omitted. */
    outputLanguage?: string;
    /** Use LLM-as-Judge to verify pattern-mode insights (default: true). */
    patternVerification?: boolean;
    /** Use LLM to check semantic novelty after trigram dedup passes (default: true). */
    llmFreshnessCheck?: boolean;
  };
  /** Feedback settings */
  feedback?: {
    /** Feedback mechanism */
    mechanism?: "emoji" | "buttons" | "text";
    /** Collect implicit feedback (default: true) */
    implicitFeedback?: boolean;
  };
  /** Skill evolution settings */
  evolution?: {
    /** Enable skill evolution suggestions (default: true) */
    enabled?: boolean;
    /** Minimum complexity score to consider (default: 0.5) */
    minComplexity?: number;
    /** Enable ClawHub skill sharing (default: false) */
    clawhubEnabled?: boolean;
    /** ClawHub registry URL */
    clawhubRegistry?: string;
    /** Auto-publish accepted skills to ClawHub (default: false) */
    clawhubAutoPublish?: boolean;
  };
};
