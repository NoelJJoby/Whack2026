import type { World } from './engine-types';
import { addEvidence, managementOwners, terminal } from './events/lifecycle';
import { consumeSlot } from './events/scheduler';
export function detectIncidents(w: World) {
  const owners = managementOwners(w); const recipients = [owners.ceo,owners.ops].filter((x): x is string => !!x);
  for (const incident of w.eventState.incidents) {
    const e = w.eventState.cases.find(e => e.id === incident.eventId)!;
    if (!e.detected && w.tick >= incident.detectedAt) {
      e.detected = true; e.owner = owners.ceo;
      addEvidence(w,e,'Monitoring confirms an access exposure; scope requires investigation.','monitoring',recipients);
    }
    if (e.exposure && !e.contained && w.tick >= incident.materialAt && e.rarity !== 'rare') {
      e.rarity = 'rare'; e.severity = 'high';
      addEvidence(w,e,'Investigation confirms material client data exposure. Containment remains required.','security monitoring',recipients);
      consumeSlot(w,'rare','promoted_existing_incident',e.id);
    }
  }
  // Delivered employee reports route through Ops. Urgent security evidence alerts both leaders.
  for (const evidence of [...w.eventState.evidence]) {
    const event = w.eventState.cases.find(e => e.id === evidence.eventId);
    if (!event || terminal(event) || evidence.deliveryTick > w.tick || !owners.ceo || evidence.recipients.includes(owners.ceo)) continue;
    if (owners.ops && evidence.recipients.includes(owners.ops)) evidence.recipients.push(owners.ceo);
  }
}
