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
    /** Cooldown between suggestions in hours (default: 24) */
    cooldownHours?: number;
    /** Max suggestions per user per day (default: 3) */
    maxSuggestionsPerDay?: number;
  };
};
