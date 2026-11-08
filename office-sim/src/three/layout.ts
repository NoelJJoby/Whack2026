// Floor plan in world units (x right, z towards the street). Seats face +z; the desk sits in front.
export const FLOOR = 0.2;

export interface Seat { x: number; z: number }

/** Desk seats joined to the cast on archetype (the same key as the looks in src/people.tsx). */
export const SEATS: Record<string, Seat> = {
  'CEO': { x: 8, z: -4.4 },
  'Ops manager': { x: -3.6, z: -4.6 },
  'Breadwinner': { x: -0.4, z: -4.6 },
  'Gossip hub': { x: 2.8, z: -4.6 },
  'Climber': { x: -4.4, z: 0.6 },
  'Loyalist': { x: -1.3, z: 0.6 },
  'Skeptic': { x: 1.8, z: 0.6 },
  'Flight risk': { x: 4.9, z: 0.6 },
};
export const SEAT_LIST = Object.values(SEATS);
export const DESK_OFFSET = 0.75;

export function seatFor(archetype: string, index: number): Seat {
  return SEATS[archetype] ?? SEAT_LIST[index % SEAT_LIST.length];
}
