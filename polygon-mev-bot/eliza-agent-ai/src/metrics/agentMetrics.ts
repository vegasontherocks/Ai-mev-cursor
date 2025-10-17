import { elizaLogger } from "@ai16z/eliza";

export type OpportunityOrigin = "blockchain-monitor" | "loop-detector" | "other";

export interface StrategyDecisionRecord {
  type: string;
  shouldExecute: boolean;
  confidence: number;
}

export interface MetricsSnapshot {
  uptimeMs: number;
  dryRunEnabled: boolean;
  opportunities: {
    detected: {
      total: number;
      byOrigin: Record<OpportunityOrigin, number>;
      lastDetectedAt: number | null;
    };
    analyzed: number;
    readyForExecution: number;
    forwarded: number;
  };
  routePlans: {
    attempted: number;
    successful: number;
    lastSuccessAt: number | null;
  };
  simulations: {
    attempted: number;
    succeeded: number;
    failed: number;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
  };
  executions: {
    submitted: number;
    confirmed: number;
    failed: number;
    dryRunSkipped: number;
    lastSubmissionAt: number | null;
    lastConfirmationAt: number | null;
    lastFailureAt: number | null;
    lastFailureReason: string | null;
  };
  lastDecision: StrategyDecisionRecord | null;
}

interface MutableMetrics extends MetricsSnapshot {
  startedAt: number;
}

const defaultsByOrigin: Record<OpportunityOrigin, number> = {
  "blockchain-monitor": 0,
  "loop-detector": 0,
  other: 0
};

const state: MutableMetrics = {
  startedAt: Date.now(),
  uptimeMs: 0,
  dryRunEnabled: process.env.DRY_RUN === "true",
  opportunities: {
    detected: {
      total: 0,
      byOrigin: { ...defaultsByOrigin },
      lastDetectedAt: null
    },
    analyzed: 0,
    readyForExecution: 0,
    forwarded: 0
  },
  routePlans: {
    attempted: 0,
    successful: 0,
    lastSuccessAt: null
  },
  simulations: {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    lastSuccessAt: null,
    lastFailureAt: null
  },
  executions: {
    submitted: 0,
    confirmed: 0,
    failed: 0,
    dryRunSkipped: 0,
    lastSubmissionAt: null,
    lastConfirmationAt: null,
    lastFailureAt: null,
    lastFailureReason: null
  },
  lastDecision: null
};

function updateUptime() {
  state.uptimeMs = Date.now() - state.startedAt;
  state.dryRunEnabled = process.env.DRY_RUN === "true";
}

export function recordOpportunityDetected(origin: OpportunityOrigin): void {
  const source = origin ?? "other";
  state.opportunities.detected.total += 1;
  state.opportunities.detected.byOrigin[source] =
    (state.opportunities.detected.byOrigin[source] ?? 0) + 1;
  state.opportunities.detected.lastDetectedAt = Date.now();
}

export function recordOpportunityForwarded(): void {
  state.opportunities.forwarded += 1;
}

export function recordOpportunityAnalyzed(): void {
  state.opportunities.analyzed += 1;
}

export function recordOpportunityReadyForExecution(): void {
  state.opportunities.readyForExecution += 1;
}

export function recordRoutePlan(success: boolean): void {
  state.routePlans.attempted += 1;
  if (success) {
    state.routePlans.successful += 1;
    state.routePlans.lastSuccessAt = Date.now();
  }
}

export function recordSimulationResult(success: boolean): void {
  state.simulations.attempted += 1;
  if (success) {
    state.simulations.succeeded += 1;
    state.simulations.lastSuccessAt = Date.now();
  } else {
    state.simulations.failed += 1;
    state.simulations.lastFailureAt = Date.now();
  }
}

export function recordDryRunSkip(reason?: string): void {
  state.executions.dryRunSkipped += 1;
  state.executions.lastFailureReason = reason || "dry-run";
}

export function recordExecutionSubmitted(): void {
  state.executions.submitted += 1;
  state.executions.lastSubmissionAt = Date.now();
}

export function recordExecutionConfirmed(): void {
  state.executions.confirmed += 1;
  state.executions.lastConfirmationAt = Date.now();
}

export function recordExecutionFailure(reason?: string): void {
  state.executions.failed += 1;
  state.executions.lastFailureAt = Date.now();
  state.executions.lastFailureReason = reason || null;
}

export function recordStrategyDecision(decision: StrategyDecisionRecord): void {
  state.lastDecision = decision;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  updateUptime();
  const byOrigin: Record<OpportunityOrigin, number> = {
    "blockchain-monitor": state.opportunities.detected.byOrigin["blockchain-monitor"] ?? 0,
    "loop-detector": state.opportunities.detected.byOrigin["loop-detector"] ?? 0,
    other: state.opportunities.detected.byOrigin.other ?? 0
  };

  return {
    uptimeMs: state.uptimeMs,
    dryRunEnabled: state.dryRunEnabled,
    opportunities: {
      detected: {
        total: state.opportunities.detected.total,
        byOrigin,
        lastDetectedAt: state.opportunities.detected.lastDetectedAt
      },
      analyzed: state.opportunities.analyzed,
      readyForExecution: state.opportunities.readyForExecution,
      forwarded: state.opportunities.forwarded
    },
    routePlans: {
      attempted: state.routePlans.attempted,
      successful: state.routePlans.successful,
      lastSuccessAt: state.routePlans.lastSuccessAt
    },
    simulations: {
      attempted: state.simulations.attempted,
      succeeded: state.simulations.succeeded,
      failed: state.simulations.failed,
      lastSuccessAt: state.simulations.lastSuccessAt,
      lastFailureAt: state.simulations.lastFailureAt
    },
    executions: {
      submitted: state.executions.submitted,
      confirmed: state.executions.confirmed,
      failed: state.executions.failed,
      dryRunSkipped: state.executions.dryRunSkipped,
      lastSubmissionAt: state.executions.lastSubmissionAt,
      lastConfirmationAt: state.executions.lastConfirmationAt,
      lastFailureAt: state.executions.lastFailureAt,
      lastFailureReason: state.executions.lastFailureReason
    },
    lastDecision: state.lastDecision
  };
}

export function resetMetrics(): void {
  elizaLogger.warn("Resetting agent metrics");
  Object.assign(state.opportunities.detected, {
    total: 0,
    byOrigin: { ...defaultsByOrigin },
    lastDetectedAt: null
  });
  state.opportunities.analyzed = 0;
  state.opportunities.readyForExecution = 0;
  state.opportunities.forwarded = 0;
  state.routePlans = { attempted: 0, successful: 0, lastSuccessAt: null };
  state.simulations = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    lastSuccessAt: null,
    lastFailureAt: null
  };
  state.executions = {
    submitted: 0,
    confirmed: 0,
    failed: 0,
    dryRunSkipped: 0,
    lastSubmissionAt: null,
    lastConfirmationAt: null,
    lastFailureAt: null,
    lastFailureReason: null
  };
  state.lastDecision = null;
  state.startedAt = Date.now();
  updateUptime();
}
