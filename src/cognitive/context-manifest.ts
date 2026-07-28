import type { CorrectionRecord } from "./correction/types.js";
import type { CognitiveMode, ModeClassification, PersonaTree } from "./types.js";

export interface ContextManifest {
  timestamp: number;
  mode: CognitiveMode;
  modeConfidence: number;
  personaActive: boolean;
  personaDomainCount: number;
  correctionsAvailable: number;
  correctionsInjected: number;
  correctionIds: string[];
  evolutionSectionActive: boolean;
  useSummaryLayer: boolean;
}

export function buildContextManifest(params: {
  classification: ModeClassification;
  persona?: PersonaTree;
  selectedCorrections: CorrectionRecord[];
  totalCorrectionsAvailable: number;
  evolutionEnabled: boolean;
  useSummaryLayer: boolean;
}): ContextManifest {
  return {
    timestamp: Date.now(),
    mode: params.classification.mode,
    modeConfidence: params.classification.confidence,
    personaActive: Boolean(params.persona),
    personaDomainCount: params.persona ? Object.keys(params.persona.domains).length : 0,
    correctionsAvailable: params.totalCorrectionsAvailable,
    correctionsInjected: params.selectedCorrections.length,
    correctionIds: params.selectedCorrections.map((c) => c.id),
    evolutionSectionActive: params.evolutionEnabled,
    useSummaryLayer: params.useSummaryLayer,
  };
}
