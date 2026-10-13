import defaults from "../../config/compiler.json";

export interface CompilerConfig {
  weights: {
    exact: number;
    alias: number;
    semantic: number;
    role_alignment: number;
    evidence_quality: number;
  };
  requirement_weights: {
    gate: number;
    must: number;
    preferred: number;
    responsibility: number;
    soft: number;
    ignore: number;
  };
  support_gates: {
    direct: number;
    alias: number;
    text_review: number;
    semantic_suggestion: number;
    none: number;
  };
  selection: {
    max_major_entries: number;
    max_bullets_per_entry: number;
    min_bullets_per_entry: number;
    line_budget: number;
    diminishing: number;
    stop_gain: number;
  };
  semantic: {
    enabled: boolean;
    mode: "lexical_overlap" | "off";
    suggestion_threshold: number;
    suggestions_per_requirement: number;
  };
  evidence_ceiling: {
    strong: number;
    partial: number;
  };
}

export const DEFAULT_CONFIG = defaults as CompilerConfig;

export function resolveConfig(override?: Partial<CompilerConfig>): CompilerConfig {
  if (!override) return DEFAULT_CONFIG;
  return {
    weights: { ...DEFAULT_CONFIG.weights, ...override.weights },
    requirement_weights: {
      ...DEFAULT_CONFIG.requirement_weights,
      ...override.requirement_weights,
    },
    support_gates: { ...DEFAULT_CONFIG.support_gates, ...override.support_gates },
    selection: { ...DEFAULT_CONFIG.selection, ...override.selection },
    semantic: { ...DEFAULT_CONFIG.semantic, ...override.semantic },
    evidence_ceiling: {
      ...DEFAULT_CONFIG.evidence_ceiling,
      ...override.evidence_ceiling,
    },
  };
}
