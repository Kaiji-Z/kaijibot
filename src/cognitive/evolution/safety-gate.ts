export type RiskLevel = "read" | "suggest" | "write" | "destructive";

export type OperationRequest = {
  operation: string;
  riskLevel: RiskLevel;
  targetDescription: string;
  userId: string;
};

export type SafetyDecision = {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason: string;
};

export class SafetyGate {
  evaluate(request: OperationRequest, trustScore: number): SafetyDecision {
    switch (request.riskLevel) {
      case "read":
        return { allowed: true, requiresConfirmation: false, reason: "Read operations always allowed" };

      case "suggest":
        return { allowed: true, requiresConfirmation: false, reason: "Suggest operations always allowed — user chooses whether to act" };

      case "write":
        if (trustScore >= 0.5) {
          return { allowed: true, requiresConfirmation: false, reason: `Trust score ${trustScore.toFixed(2)} >= 0.50 — write auto-approved` };
        }
        return { allowed: true, requiresConfirmation: true, reason: `Trust score ${trustScore.toFixed(2)} < 0.50 — write requires confirmation` };

      case "destructive":
        if (trustScore < 0.3) {
          return { allowed: false, requiresConfirmation: true, reason: `Trust score ${trustScore.toFixed(2)} < 0.30 — destructive operations denied` };
        }
        if (trustScore >= 0.7) {
          return { allowed: true, requiresConfirmation: true, reason: `Trust score ${trustScore.toFixed(2)} >= 0.70 — destructive allowed with confirmation (batch ok)` };
        }
        return { allowed: true, requiresConfirmation: true, reason: `Trust score ${trustScore.toFixed(2)} — destructive requires individual confirmation` };

      default:
        return { allowed: false, requiresConfirmation: true, reason: `Unknown risk level: ${request.riskLevel}` };
    }
  }
}
