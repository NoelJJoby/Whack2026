export interface ReportFacts {
  runId: string; cutoff: number; tick: number; currency: string; hash: string;
  metrics: Record<string, number>; evidence: Array<{ id: string; tick: number; text: string }>;
  unresolved: string[];
}
export interface ReportSection { title: string; observations: Array<{ evidenceIds: string[]; metricIds: string[]; assessment: 'observed' | 'recommendation'; text: string }> }
export interface BusinessReport {
  id: string; runId: string; version: number; cutoff: number; tick: number; generatedAt: string;
  status: 'ready' | 'factual_fallback'; limitation: string | null; facts: ReportFacts;
  quarterSummary?: QuarterSummary;
  sections: ReportSection[]; schemaVersion: 1; promptVersion: 1; model: string | null; telemetry: unknown[];
}
export interface RunMetadata { id: string; seed: number; createdAt: string; tick: number; sequence: number; status: 'active' | 'partial' | 'complete'; reports: string[]; }

export interface QuarterHighlight {
  candidateId: string; title: string; explanation: string; evidenceIds: string[]; metricIds: string[];
}
export interface QuarterRecap {
  status: 'pending' | 'ready' | 'unavailable'; summary: string;
  bestMove: QuarterHighlight | null; biggestBlunder: QuarterHighlight | null;
  lessons: Array<{ text: string; evidenceIds: string[] }>;
}
export interface QuarterCandidate {
  id: string; tick: number; decisionTick: number; carryForward: boolean;
  actor: { id: string; name: string; role: 'player' | 'ceo' | 'ops' | 'employee' | 'management' };
  action: string; outcome: 'positive' | 'negative' | 'unresolved'; excerpt: string;
  knownThen: string[]; risks: string[]; evidenceIds: string[]; metricIds: string[];
  severity: number; monetaryImpact: number; peopleImpact: number; deadline: number;
}
export interface QuarterFacts {
  runId: string; quarter: number; startTick: number; endTick: number; cutoff: number; partial: boolean; hash: string;
  currency: string; metrics: Record<string, number>;
  peak: { tick: number; price: number; opening: boolean; label: string };
  prices: Array<{ tick: number; price: number }>;
  candidates: QuarterCandidate[]; evidence: ReportFacts['evidence'];
}
export interface QuarterSummary {
  schemaVersion: 1; promptVersion: 1; recoveryAttempted?: boolean;
  quarters: Array<{ facts: QuarterFacts; recap: QuarterRecap }>;
}
