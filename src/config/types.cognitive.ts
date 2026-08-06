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
    /** Digest mode (reserved — not yet implemented; all pushes are realtime) */
    digestMode?: "realtime" | "daily" | "weekly";
    /** Epsilon-greedy exploration probability (0-1, default 0.2). Promotes exploration candidates with probability ε. Set to 0 to disable. */
    epsilonGreedy?: number;
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
    /** Output language for generated insights (default: "zh"). Auto-detected from persona if omitted. */
    outputLanguage?: string;
    /** Use LLM-as-Judge to verify pattern-mode insights (default: true). */
    patternVerification?: boolean;
    /** Use LLM to check semantic novelty after trigram dedup passes (default: true). */
    llmFreshnessCheck?: boolean;
  };
  /** Feedback settings (reserved — currently unused by runtime; feedback is collected implicitly by default) */
  feedback?: {
    /** Feedback mechanism (reserved — not yet implemented) */
    mechanism?: "emoji" | "buttons" | "text";
    /** Collect implicit feedback (reserved — always true in practice) */
    implicitFeedback?: boolean;
  };
  /** Skill evolution settings */
  evolution?: {
    /** Enable skill evolution suggestions (default: true) */
    enabled?: boolean;
    /** Override model for quality gate judge (format: "provider/model"). When set, the judge uses a different model than the draft generator, reducing self-scoring bias. */
    qualityGateModel?: string;
  };
  /** Correction memory settings */
  correction?: {
    /** Enable correction extraction and injection (default: true). When false, no post-session extraction in session-memory hook, no agent self-report tool, and no system prompt injection of past corrections. */
    enabled?: boolean;
  };
  /** Continuity handshake — when the user initiates after a gap, the agent opens by acknowledging prior context (recent focus, last delivered insight) before answering. Pull-side, zero interruption cost. */
  handshake?: {
    /** Enable continuity handshake (default: true). */
    enabled?: boolean;
    /** Minimum hours since last interaction before handshake is triggered (default: 6). Below this gap, the agent answers directly without the opening acknowledgment. */
    minGapHours?: number;
  };
};
