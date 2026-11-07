// Hand-placed waypoint graph (no pathfinding library). Agents only ever walk along these edges,
// so nobody crosses a wall. Nodes on the three aisles (same z) are chained automatically by x.
import { DESK_OFFSET, type Seat } from './layout';

export type P = [number, number];

const AISLE_BACK = -5.8, AISLE_MID = -0.6, AISLE_FRONT = 3.2;

const BASE: Record<string, P> = {
  // Back aisle: coffee bar and water cooler.
  aL: [-5.6, AISLE_BACK], aC: [1.2, AISLE_BACK], coffee: [0.2, AISLE_BACK], cooler: [2.4, AISLE_BACK],
  // Middle aisle (behind the front row) up to the CEO door.
  mL: [-5.6, AISLE_MID], mC: [1.2, AISLE_MID], mD: [0.25, AISLE_MID], mR: [6.6, AISLE_MID], ceoOut: [7.5, AISLE_MID],
  // Left column and meeting room (window on the left wall).
  lc: [-5.6, -2.5], meetIn: [-7, -2.5], meet: [-7, -4.4], meetBack: [-7, -6.2], meetCorner: [-10.2, -6.2], winMeet: [-10.4, -4.4],
  // Front aisle, lounge (sofa, window), front door, street.
  fL: [-10.2, AISLE_FRONT], fLounge: [-6.8, AISLE_FRONT], fCol: [-5.6, AISLE_FRONT], fDoor: [0.25, AISLE_FRONT], fR: [6.6, AISLE_FRONT],
  sofaPathR: [-6.8, 1.0], sofaA: [-8.0, 0.15], sofaPathL: [-10.2, 1.0], sofaB: [-9.4, 0.15], winLounge: [-10.4, 2.3],
  doorIn: [0, 4.6], doorOut: [0, 5.9], path: [0, 7.6], interview: [1.0, 7.6], pave: [0, 10.75], exit: [-17.5, 10.75],
  // CEO office: through the glass door, round the desk.
  ceoDoor: [7.5, -1.6], ceoA: [6.2, -2.6], ceoB: [6.2, -5.4], ceoBack: [8, -5.4],
};
const EDGES = `aL-lc lc-mL mL-fCol lc-meetIn meetIn-meet meet-meetBack meetBack-meetCorner meetCorner-winMeet
  aC-mC mD-fDoor mR-fR ceoOut-ceoDoor ceoDoor-ceoA ceoA-ceoB ceoB-ceoBack
  fLounge-sofaPathR sofaPathR-sofaA fL-sofaPathL sofaPathL-sofaB fL-winLounge
  fDoor-doorIn doorIn-doorOut doorOut-path path-interview path-pave pave-exit`;

export interface Nav {
  pos: Map<string, P>;
  /** Shortest route from one node to another, both ends included. */
  route: (from: string, to: string) => string[];
}

export const seatNode = (id: string) => `seat_${id}`;
export const accessNode = (id: string, ceo: boolean) => (ceo ? 'ceoBack' : `acc_${id}`);

export function buildNav(seats: Array<{ id: string; seat: Seat; ceo: boolean }>): Nav {
  const pos = new Map<string, P>(Object.entries(BASE));
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b); adj.get(b)!.add(a);
  };
  for (const pair of EDGES.trim().split(/\s+/)) { const [a, b] = pair.split('-'); link(a, b); }
  for (const { id, seat, ceo } of seats) {
    pos.set(seatNode(id), [seat.x, seat.z]);
    if (!ceo) pos.set(accessNode(id, false), [seat.x, seat.z + DESK_OFFSET < -2 ? AISLE_BACK : AISLE_MID]);
    link(seatNode(id), accessNode(id, ceo));
  }
  for (const z of [AISLE_BACK, AISLE_MID, AISLE_FRONT]) {
    const row = [...pos].filter(([, p]) => p[1] === z).sort((a, b) => a[1][0] - b[1][0]);
    for (let i = 1; i < row.length; i++) link(row[i - 1][0], row[i][0]);
  }
  const dist = (a: string, b: string) => Math.hypot(pos.get(a)![0] - pos.get(b)![0], pos.get(a)![1] - pos.get(b)![1]);
  // Dijkstra over ~50 nodes: a linear scan is plenty.
  function route(from: string, to: string): string[] {
    if (from === to || !pos.has(from) || !pos.has(to)) return [from];
    const best = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const open = new Set([from]);
    while (open.size) {
      let cur = '', curD = Infinity;
      for (const n of open) if (best.get(n)! < curD) { cur = n; curD = best.get(n)!; }
      open.delete(cur);
      if (cur === to) break;
      for (const next of adj.get(cur) ?? []) {
        const d = curD + dist(cur, next);
        if (d < (best.get(next) ?? Infinity)) { best.set(next, d); prev.set(next, cur); open.add(next); }
      }
    }
    if (!prev.has(to)) return [from];
    const out = [to];
    while (out[0] !== from) out.unshift(prev.get(out[0])!);
    return out;
  }
  return { pos, route };
}
