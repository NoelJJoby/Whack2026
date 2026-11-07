// The static diorama as box data: plot, street, building with cutaway walls, rooms and furniture.
import { DESK_OFFSET, FLOOR, SEAT_LIST, type Seat } from './layout';
import type { Box } from './voxel';

export const solid: Box[] = [];
export const glow: Box[] = [];
export const glass: Box[] = [];
const S = (...b: Box) => solid.push(b);
const G = (...b: Box) => glow.push(b);
const F = FLOOR;

const WALL = '#557a5c', WALL_LOW = '#45644b', TRIM = '#2a2e36', WOOD = '#8a5a36', WOOD_D = '#6b4428';

// Ground: dirt slab, grass, street, pavement, path, parking.
S(0, -1.4, 1.5, 34, 0.9, 27, '#5e4230');
S(0, -0.5, 1.5, 34, 0.5, 27, '#6f9a45');
S(0, -0.5, 13, 34, 0.54, 3, '#474a52');
for (let x = -15; x <= 15; x += 2.5) S(x, 0.04, 13, 1.2, 0.02, 0.14, '#e8e2cf');
S(0, -0.5, 10.75, 34, 0.6, 1.5, '#b7b0a3');
for (let x = -16.5; x <= 16.5; x += 1.5) S(x, 0.1, 10.75, 0.04, 0.01, 1.5, '#9d968a');
S(0, -0.5, 7.7, 2, 0.56, 4.6, '#c8bead');
S(11.5, -0.5, 8.2, 7, 0.55, 3.6, '#55585f');
for (let x = 9; x <= 14; x += 2.5) S(x, 0.05, 8.2, 0.1, 0.01, 2.6, '#e8e2cf');

// Building shell.
S(0, 0, -1, 22.6, F - 0.02, 12.6, TRIM);
S(0, F - 0.06, -1, 22, 0.06, 12, '#c98b52');
for (let x = -10.5; x <= 10.5; x += 1) S(x, F - 0.005, -1, 0.04, 0.01, 12, '#b67a45');
// Back wall (full height) with lit windows.
S(0, F, -7.15, 22.6, 3.2, 0.3, WALL);
S(0, F, -6.98, 22, 0.8, 0.04, WALL_LOW);
S(0, F + 3.2, -7.15, 22.8, 0.15, 0.45, TRIM);
for (const x of [-8.5, -3.2, 3.2, 8.2]) {
  S(x, F + 1.35, -6.99, 2.5, 1.3, 0.06, TRIM);
  G(x, F + 1.45, -6.95, 2.3, 1.1, 0.04, '#ffd58a');
  S(x, F + 1.45, -6.92, 0.08, 1.1, 0.04, TRIM);
}
// Left wall (full height) with windows.
S(-11.15, F, -1, 0.3, 3.2, 12.6, WALL);
S(-11.15, F + 3.2, -1, 0.45, 0.15, 12.8, TRIM);
for (const z of [-4.5, 2.5]) {
  S(-10.99, F + 1.35, z, 0.06, 1.3, 2.5, TRIM);
  G(-10.95, F + 1.45, z, 0.04, 1.1, 2.3, '#ffd58a');
}
// Right and front walls are cut away low so the interior shows.
S(11.15, F, -1, 0.3, 0.7, 12.6, WALL);
S(11.15, F + 0.7, -1, 0.42, 0.1, 12.8, TRIM);
for (const [x0, x1] of [[-11.3, -1.3], [1.3, 11.3]]) {
  S((x0 + x1) / 2, F, 5.15, x1 - x0, 0.7, 0.3, WALL);
  S((x0 + x1) / 2, F + 0.7, 5.15, x1 - x0, 0.1, 0.42, TRIM);
}
// Entrance: pillars, lintel, door lamps, step.
for (const x of [-1.45, 1.45]) {
  S(x, F, 5.15, 0.3, 1.9, 0.4, TRIM);
  G(x, F + 1.4, 5.4, 0.18, 0.25, 0.1, '#ffe6a8');
}
S(0, F + 1.9, 5.15, 3.3, 0.22, 0.45, TRIM);
S(0, 0, 5.7, 2.4, F - 0.05, 0.8, '#a9a194');

// Interior partitions (kept low so rooms stay readable).
S(-6, F, -5.1, 0.2, 1.4, 3.8, WALL);
S(-8.95, F, -1.7, 4.1, 1.0, 0.2, WALL);
// CEO glass office: mullions and rails solid, panes in the glass mesh.
for (const z of [-7, -5.5, -4, -2.5, -1]) S(5, F, z, 0.12, 2.2, 0.12, TRIM);
for (const x of [6.5, 8.5, 10]) S(x, F, -1, 0.12, 2.2, 0.12, TRIM);
S(5, F + 2.2, -4, 0.16, 0.1, 6.1, TRIM);
S(7.5, F + 2.2, -1, 5.1, 0.1, 0.16, TRIM);
glass.push([5, F, -4, 0.05, 2.2, 6, '#bfe3f2'], [5.75, F, -1, 1.5, 2.2, 0.05, '#bfe3f2'], [9.25, F, -1, 1.5, 2.2, 0.05, '#bfe3f2'], [10.5, F, -1, 1, 2.2, 0.05, '#bfe3f2']);

// Furniture helpers.
function plant(x: number, z: number, s = 1) {
  S(x, F, z, 0.4 * s, 0.4 * s, 0.4 * s, '#d8d2c4');
  S(x, F + 0.4 * s, z, 0.5 * s, 0.35 * s, 0.5 * s, '#4f8a3a');
  S(x, F + 0.7 * s, z, 0.3 * s, 0.35 * s, 0.3 * s, '#5f9e45');
}
function floorLamp(x: number, z: number) {
  S(x, F, z, 0.3, 0.06, 0.3, TRIM);
  S(x, F, z, 0.06, 1.5, 0.06, TRIM);
  G(x, F + 1.5, z, 0.36, 0.34, 0.36, '#ffe3a0');
}
function bookcase(x: number, z: number, w = 1.4, h = 1.8) {
  S(x, F, z, w, h, 0.4, WOOD_D);
  const colours = ['#b0473b', '#3f6fa0', '#d8b25a', '#5d8a4f', '#7d5aa0'];
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 5; i++) S(x - w / 2 + 0.18 + i * (w - 0.3) / 5, F + 0.2 + r * (h / 3.2), z + 0.15, 0.18, 0.35, 0.12, colours[(i + r) % 5]);
}
function chair(seat: Seat, colour = '#3a3d46') {
  S(seat.x, F, seat.z, 0.1, 0.4, 0.1, TRIM);
  S(seat.x, F + 0.4, seat.z, 0.6, 0.1, 0.6, colour);
  S(seat.x, F + 0.5, seat.z - 0.3, 0.6, 0.75, 0.1, colour);
}
function desk(seat: Seat, wide = 1.9) {
  const z = seat.z + DESK_OFFSET;
  S(seat.x, F + 0.7, z, wide, 0.1, 0.9, WOOD);
  S(seat.x - wide / 2 + 0.1, F, z, 0.12, 0.7, 0.85, WOOD_D);
  S(seat.x + wide / 2 - 0.1, F, z, 0.12, 0.7, 0.85, WOOD_D);
  S(seat.x, F + 0.15, z + 0.38, wide - 0.2, 0.5, 0.06, WOOD_D);
  // Monitor (screen face is a separate mesh so it can dim), mug, plant.
  S(seat.x + 0.4, F + 0.8, z + 0.05, 0.1, 0.12, 0.1, TRIM);
  S(seat.x + 0.4, F + 0.88, z + 0.08, 0.66, 0.4, 0.08, '#24272e');
  S(seat.x + 0.4, F + 0.8, z + 0.05, 0.36, 0.03, 0.26, TRIM);
  S(seat.x - 0.3, F + 0.8, z - 0.15, 0.16, 0.18, 0.16, '#efe9dc');
  S(seat.x - 0.75, F + 0.8, z + 0.25, 0.22, 0.2, 0.22, '#c26a43');
  S(seat.x - 0.75, F + 1.0, z + 0.25, 0.28, 0.25, 0.28, '#5f9e45');
  // Desk lamp (the bulb lights up per agent when they overwork).
  S(seat.x + 0.85, F + 0.8, z + 0.3, 0.06, 0.45, 0.06, TRIM);
  S(seat.x + 0.85, F + 1.24, z + 0.3, 0.24, 0.1, 0.24, '#2f5a46');
}
function tree(x: number, z: number, s = 1) {
  S(x, 0, z, 0.5 * s, 1.4 * s, 0.5 * s, '#6b4a2e');
  S(x, 1.1 * s, z, 2 * s, 1.1 * s, 2 * s, '#4e8a36');
  S(x, 2.2 * s, z, 1.4 * s, 0.8 * s, 1.4 * s, '#5c9c3f');
  S(x + 0.3 * s, 3 * s, z - 0.2 * s, 0.7 * s, 0.5 * s, 0.7 * s, '#6aaa48');
}
function bush(x: number, z: number, w = 1.6) {
  S(x, 0, z, w, 0.6, 0.8, '#4a8434');
  S(x - 0.2, 0.6, z, w * 0.6, 0.25, 0.6, '#5c9c3f');
}
function flowers(x: number, z: number) {
  for (const [dx, dz] of [[0, 0], [0.3, 0.2], [-0.25, 0.25], [0.1, -0.3]]) S(x + dx, 0, z + dz, 0.15, 0.22, 0.15, '#e8c33a');
}
function streetLamp(x: number, z: number) {
  S(x, 0, z, 0.3, 0.2, 0.3, TRIM);
  S(x, 0, z, 0.12, 1.1, 0.12, TRIM);
  G(x, 1.1, z, 0.26, 0.3, 0.26, '#ffe3a0');
  S(x, 1.4, z, 0.34, 0.08, 0.34, TRIM);
}
function car(x: number, z: number, colour: string, alongX: boolean) {
  const B = (dx: number, y: number, dz: number, w: number, h: number, d: number, c: string, glowing = false) =>
    (glowing ? G : S)(x + (alongX ? dx : dz), y, z + (alongX ? dz : dx), alongX ? w : d, h, alongX ? d : w, c);
  for (const dx of [-0.65, 0.65]) for (const dz of [-0.5, 0.5]) B(dx, 0.05, dz, 0.42, 0.42, 0.18, '#1c1d22');
  B(0, 0.25, 0, 2.3, 0.5, 1.1, colour);
  B(-0.1, 0.75, 0, 1.3, 0.45, 1.0, colour);
  B(-0.1, 0.8, 0, 1.36, 0.32, 1.04, '#2f3f55');
  B(1.16, 0.4, -0.35, 0.04, 0.14, 0.22, '#fff1c2', true);
  B(1.16, 0.4, 0.35, 0.04, 0.14, 0.22, '#fff1c2', true);
  B(-1.16, 0.4, -0.35, 0.04, 0.14, 0.22, '#e04a3a', true);
  B(-1.16, 0.4, 0.35, 0.04, 0.14, 0.22, '#e04a3a', true);
}

// Open plan: desks, chairs, rugs, back-wall amenities.
for (const seat of SEAT_LIST.slice(1)) { desk(seat); chair(seat); }
for (const x of [-3.6, -0.4, 2.8]) S(x, F - 0.01, -1.9, 2, 0.02, 0.9, '#7f9a63');
bookcase(-4.6, -6.75);
plant(-2.9, -6.6);
// Coffee bar: counter, machine, cups, sign.
S(0.2, F, -6.6, 2.6, 0.9, 0.6, WOOD_D);
S(0.2, F + 0.9, -6.6, 2.7, 0.08, 0.66, '#a8754a');
S(-0.6, F + 0.98, -6.7, 0.4, 0.6, 0.35, '#22252b');
G(-0.6, F + 1.3, -6.52, 0.2, 0.12, 0.02, '#f04a3a');
for (const x of [0.2, 0.5, 0.8, 1.1]) S(x, F + 0.98, -6.5, 0.14, 0.18, 0.14, '#efe9dc');
S(0.3, F + 1.9, -6.97, 1.0, 0.8, 0.04, '#d7b66c');
G(0.3, F + 1.98, -6.94, 0.84, 0.64, 0.02, '#2b2a24');
// Water cooler.
S(2.4, F, -6.6, 0.55, 1.0, 0.55, '#e9edf0');
S(2.4, F + 1.0, -6.6, 0.42, 0.6, 0.42, '#4aa3e0');
plant(4.1, -6.6);

// Meeting room.
S(-8.5, F - 0.01, -4.4, 4, 0.02, 4, '#4b5a74');
S(-8.5, F + 0.7, -4.4, 1.5, 0.1, 2.4, WOOD);
S(-8.5, F, -4.4, 0.3, 0.7, 1.8, WOOD_D);
for (const z of [-5.1, -3.7]) for (const side of [-1, 1]) {
  S(-8.5 + side * 1.1, F + 0.4, z, 0.55, 0.1, 0.55, '#d6a73c');
  S(-8.5 + side * 1.4, F + 0.5, z, 0.1, 0.6, 0.55, '#d6a73c');
  S(-8.5 + side * 1.1, F, z, 0.08, 0.4, 0.08, TRIM);
}
plant(-8.5, -4.4, 0.6);
floorLamp(-10.5, -6.5);
bookcase(-7.1, -6.75, 1.2);

// Lounge: sofa (slack-off spot), coffee table, rug, lamp.
S(-8.7, F - 0.01, 1.4, 4, 0.02, 3, '#a58c6a');
S(-8.7, F, 0.2, 2.8, 0.45, 0.9, '#c4573f');
S(-8.7, F + 0.45, -0.15, 2.8, 0.6, 0.25, '#b04a35');
for (const x of [-10.1, -7.3]) S(x, F, 0.2, 0.25, 0.7, 0.9, '#b04a35');
S(-8.7, F, 1.7, 1.4, 0.4, 0.7, WOOD_D);
S(-8.9, F + 0.4, 1.7, 0.3, 0.06, 0.25, '#3f6fa0');
floorLamp(-10.5, 3.6);
plant(-6.6, 4.4);
bookcase(-10.6, -0.6, 0.9, 1.2);

// CEO office.
S(8, F - 0.01, -3.9, 5, 0.02, 4.4, '#7a5a86');
desk(SEAT_LIST[0], 2.3);
chair(SEAT_LIST[0], '#5a4a60');
bookcase(10, -6.75, 1.2);
S(10, F + 1.85, -6.75, 0.2, 0.3, 0.2, '#e3b53f');
S(7.6, F + 1.5, -6.97, 1.8, 0.9, 0.04, '#d7b66c');
S(7.6, F + 1.58, -6.95, 1.6, 0.74, 0.02, '#6d6aa6');
plant(5.7, -6.5);
plant(10.4, -1.6, 0.8);

// Outside: trees, bushes, flowers, lamps, cars.
for (const [x, z, s] of [[-15, -9, 1], [-15, -2, 0.9], [-14.8, 6, 1], [15, -9, 0.9], [15, -2.5, 1], [14.6, 3, 0.8], [-6.5, 8.2, 0.7], [5, 8.4, 0.6]]) tree(x, z, s);
for (const [x, z] of [[-8, 6.3], [-4, 6.3], [3.5, 6.3], [7.5, 6.3]]) bush(x, z);
for (const [x, z] of [[-13, 3], [-11, 8.5], [-2.8, 8.8], [12.5, 0.5], [-13, -6]]) flowers(x, z);
for (const [x, z] of [[-1.6, 8.5], [1.6, 8.5], [-1.6, 6.6], [1.6, 6.6]]) streetLamp(x, z);
car(-6, 12.3, '#e8b730', true);
car(7, 13.7, '#3d6fb8', true);
car(10.2, 8.2, '#e6e6e6', false);
car(12.8, 8.2, '#cf4436', false);
