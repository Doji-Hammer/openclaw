/**
 * D8: Graceful Degradation Modes
 *
 * @module contracts/graceful-degradation
 */

export enum DegradationLevel {
  NORMAL = "normal",
  REDUCED = "reduced",
  MINIMAL = "minimal",
  EMERGENCY = "emergency",
}

export interface DegradationCondition {
  failureRateThreshold?: number;
  circuitOpen?: boolean;
  cascading?: boolean;
  costBudgetUsed?: number;
  errorCountThreshold?: number;
}

export interface DegradationRule {
  condition: DegradationCondition;
  level: DegradationLevel;
  disabledFeatures: string[];
  description: string;
}

export interface SystemHealth {
  failureRate: number;
  circuitOpen: boolean;
  cascading: boolean;
  costBudgetUsed: number;
  errorCount: number;
}

const DEFAULT_RULES: DegradationRule[] = [
  {
    condition: { failureRateThreshold: 0.5, circuitOpen: true },
    level: DegradationLevel.EMERGENCY,
    disabledFeatures: ["tool_execution", "web_search", "browser", "complex_planning"],
    description: "Emergency: >50% failure rate with open circuit",
  },
  {
    condition: { cascading: true },
    level: DegradationLevel.MINIMAL,
    disabledFeatures: ["tool_execution", "web_search", "browser"],
    description: "Minimal: cascading failure detected",
  },
  {
    condition: { costBudgetUsed: 0.9 },
    level: DegradationLevel.MINIMAL,
    disabledFeatures: ["complex_planning", "large_context"],
    description: "Minimal: >90% of cost budget used",
  },
  {
    condition: { failureRateThreshold: 0.3 },
    level: DegradationLevel.REDUCED,
    disabledFeatures: ["browser", "complex_planning"],
    description: "Reduced: >30% failure rate",
  },
  {
    condition: { errorCountThreshold: 10 },
    level: DegradationLevel.REDUCED,
    disabledFeatures: ["browser"],
    description: "Reduced: >10 errors in window",
  },
];

export class DegradationManager {
  private rules: DegradationRule[];
  private currentLevel: DegradationLevel = DegradationLevel.NORMAL;
  private disabledFeatures = new Set<string>();
  private history: Array<{ level: DegradationLevel; timestamp: number; reason: string }> = [];

  constructor(rules?: DegradationRule[]) {
    this.rules = rules ?? [...DEFAULT_RULES];
  }

  evaluate(health: SystemHealth): {
    level: DegradationLevel;
    changed: boolean;
    disabledFeatures: string[];
    activeRules: string[];
  } {
    let highestLevel = DegradationLevel.NORMAL;
    const allDisabled = new Set<string>();
    const activeRules: string[] = [];

    for (const rule of this.rules) {
      if (this.conditionMet(rule.condition, health)) {
        activeRules.push(rule.description);
        for (const f of rule.disabledFeatures) allDisabled.add(f);
        if (this.levelSeverity(rule.level) > this.levelSeverity(highestLevel)) {
          highestLevel = rule.level;
        }
      }
    }

    const changed = highestLevel !== this.currentLevel;
    if (changed) {
      this.history.push({
        level: highestLevel,
        timestamp: Date.now(),
        reason: activeRules.join("; ") || "conditions cleared",
      });
    }

    this.currentLevel = highestLevel;
    this.disabledFeatures = allDisabled;

    return { level: highestLevel, changed, disabledFeatures: Array.from(allDisabled), activeRules };
  }

  isFeatureAvailable(feature: string): boolean {
    return !this.disabledFeatures.has(feature);
  }

  getLevel(): DegradationLevel {
    return this.currentLevel;
  }

  getDisabledFeatures(): string[] {
    return Array.from(this.disabledFeatures);
  }

  getHistory(): Array<{ level: DegradationLevel; timestamp: number; reason: string }> {
    return [...this.history];
  }

  forceLevel(level: DegradationLevel, reason: string): void {
    this.currentLevel = level;
    this.history.push({ level, timestamp: Date.now(), reason: `FORCED: ${reason}` });
  }

  reset(): void {
    this.currentLevel = DegradationLevel.NORMAL;
    this.disabledFeatures.clear();
    this.history.push({
      level: DegradationLevel.NORMAL,
      timestamp: Date.now(),
      reason: "manual reset",
    });
  }

  private conditionMet(condition: DegradationCondition, health: SystemHealth): boolean {
    if (
      condition.failureRateThreshold !== undefined &&
      health.failureRate < condition.failureRateThreshold
    )
      return false;
    if (condition.circuitOpen !== undefined && health.circuitOpen !== condition.circuitOpen)
      return false;
    if (condition.cascading !== undefined && health.cascading !== condition.cascading) return false;
    if (condition.costBudgetUsed !== undefined && health.costBudgetUsed < condition.costBudgetUsed)
      return false;
    if (
      condition.errorCountThreshold !== undefined &&
      health.errorCount < condition.errorCountThreshold
    )
      return false;
    return (
      condition.failureRateThreshold !== undefined ||
      condition.circuitOpen !== undefined ||
      condition.cascading !== undefined ||
      condition.costBudgetUsed !== undefined ||
      condition.errorCountThreshold !== undefined
    );
  }

  private levelSeverity(level: DegradationLevel): number {
    const map: Record<DegradationLevel, number> = {
      [DegradationLevel.NORMAL]: 0,
      [DegradationLevel.REDUCED]: 1,
      [DegradationLevel.MINIMAL]: 2,
      [DegradationLevel.EMERGENCY]: 3,
    };
    return map[level];
  }
}
