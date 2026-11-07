import { z } from 'zod';
export const choiceSchema = z.object({ eventId: z.string(), optionId: z.string(), priority: z.number().int().min(1).max(5), budget: z.number().int().nonnegative(), deadline: z.number().int(), acceptance: z.string().min(1).max(400), communicate: z.array(z.string()).max(8), reviewTick: z.number().int() }).strict();
export const ceoSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('ceo'), revision: z.number().int(), choices: z.array(choiceSchema).max(32), rationale: z.string().min(1).max(1200) }).strict();
export const opsSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('ops'), revision: z.number().int(), assignments: z.array(z.object({ taskId: z.string(), employeeId: z.string().nullable(), state: z.enum(['active','paused']), allocation: z.number().min(0).max(1) }).strict()).max(64), infeasible: z.array(z.string()).max(64), rationale: z.string().min(1).max(1200) }).strict();
const task = { task_id: z.string().min(1), assignment_version: z.number().int().positive() };
const social = z.object({ action: z.enum(['slack_off','complain','gossip','verify','interview','leak']), weight: z.number().nonnegative(), target: z.string().nullable().optional(), claim: z.string().nullable().optional() }).strict();
export const employeeProposalSchema = z.union([
  z.object({ action: z.enum(['work','overwork','review_work']), weight: z.number().nonnegative(), ...task }).strict(),
  z.object({ action: z.literal('support_colleague'), weight: z.number().nonnegative(), ...task, target: z.string() }).strict(),
  z.object({ action: z.literal('report_issue'), weight: z.number().nonnegative(), evidence_id: z.string(), target: z.string() }).strict(), social,
]);
export const employeeSchema = z.object({ proposals: z.array(employeeProposalSchema).min(1).max(3), public_line: z.string().max(400), inner_monologue: z.string().max(400), beliefs: z.record(z.number().min(0).max(100)) }).strict();
export const reportSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('report'), sections: z.array(z.object({ title: z.string().max(120), observations: z.array(z.object({ evidenceIds: z.array(z.string()).min(1).max(12), metricIds: z.array(z.string()).max(12), assessment: z.enum(['observed','recommendation']), text: z.string().min(1).max(600) }).strict()).min(1).max(12) }).strict()).min(1).max(8) }).strict();
