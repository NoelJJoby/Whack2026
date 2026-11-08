// Tiny voxel kit: describe boxes as data, bake each kind into one merged mesh (one draw call).
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, MeshLambertMaterial } from 'three';

/** [x, y (bottom), z, width, height, depth, colour] */
export type Box = [number, number, number, number, number, number, string];

const unit = new BoxGeometry(1, 1, 1);
const uPos = unit.attributes.position.array as Float32Array;
const uNorm = unit.attributes.normal.array as Float32Array;
const uIdx = unit.index!.array as Uint16Array;
const tmp = new Color();

export function bake(boxes: Box[]): BufferGeometry {
  const vCount = uPos.length / 3;
  const pos = new Float32Array(boxes.length * uPos.length);
  const norm = new Float32Array(boxes.length * uNorm.length);
  const col = new Float32Array(boxes.length * uPos.length);
  const idx = new Uint32Array(boxes.length * uIdx.length);
  boxes.forEach(([x, y, z, w, h, d, c], b) => {
    tmp.set(c);
    const o = b * uPos.length;
    for (let i = 0; i < uPos.length; i += 3) {
      pos[o + i] = x + uPos[i] * w;
      pos[o + i + 1] = y + h / 2 + uPos[i + 1] * h;
      pos[o + i + 2] = z + uPos[i + 2] * d;
      norm[o + i] = uNorm[i]; norm[o + i + 1] = uNorm[i + 1]; norm[o + i + 2] = uNorm[i + 2];
      col[o + i] = tmp.r; col[o + i + 1] = tmp.g; col[o + i + 2] = tmp.b;
    }
    for (let i = 0; i < uIdx.length; i++) idx[b * uIdx.length + i] = uIdx[i] + b * vCount;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(norm, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const mats = new Map<string, MeshLambertMaterial>();
/** Shared Lambert material per colour (cheap on integrated GPUs). */
export function mat(color: string, emissive?: string) {
  const key = color + (emissive ?? '');
  let m = mats.get(key);
  if (!m) mats.set(key, (m = new MeshLambertMaterial({ color, emissive: emissive ?? '#000000' })));
  return m;
}
export const unitBox = unit;
