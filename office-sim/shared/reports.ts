export interface ReportFacts {
  runId: string; cutoff: number; tick: number; currency: string; hash: string;
  metrics: Record<string, number>; evidence: Array<{ id: string; tick: number; text: string }>;
  unresolved: string[];
}
export interface ReportSection { title: string; observations: Array<{ evidenceIds: string[]; metricIds: string[]; assessment: 'observed' | 'recommendation'; text: string }> }
export interface BusinessReport {
  id: string; runId: string; version: number; cutoff: number; tick: number; generatedAt: string;
  status: 'ready' | 'factual_fallback'; limitation: string | null; facts: ReportFacts;
  sections: ReportSection[]; schemaVersion: 1; promptVersion: 1; model: string | null; telemetry: unknown[];
}
export interface RunMetadata { id: string; seed: number; createdAt: string; tick: number; sequence: number; status: 'active' | 'partial' | 'complete'; reports: string[]; }
