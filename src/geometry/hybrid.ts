import type { Axial, Layout, OpticalCell, PaletteName } from '../types.js';

export const SQRT3 = Math.sqrt(3);
export const NEIGHBORS: readonly Axial[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];
export const key = (q: number, r: number) => `${q},${r}`;
export const normMod = (n: number, divisor: number) => ((n % divisor) + divisor) % divisor;
export function d2(q: number, r: number): number {
  return 3 * (q * q + q * r + r * r);
}
export function axialToXY(q: number, r: number, a = 1): { x: number; y: number } {
  return { x: 1.5 * a * q, y: SQRT3 * a * (r + q / 2) };
}
export function isCandidate(q: number, r: number, S: number): boolean {
  const dd = d2(q, r);
  return dd >= 81 && dd <= (S - 1) * (S - 1);
}
export function cubeRound(x: number, y: number): Axial {
  const qf = 2 * x / 3;
  const rf = y / SQRT3 - qf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const eq = Math.abs(q - qf), er = Math.abs(r - rf), es = Math.abs(s - sf);
  if (eq > er && eq > es) q = -r - s;
  else if (er > es) r = -q - s;
  else s = -q - r;
  return { q, r };
}

export function buildLayout(S: number, palette: PaletteName, seed = 0x4f4d): Layout {
  if (!Number.isInteger(S) || S < 32 || S > 512 || S % 16 !== 0) {
    throw new RangeError('S must be a multiple of 16 in [32,512]');
  }
  if (palette !== 'DENSE_8' && palette !== 'RELIABLE_4') throw new RangeError('Unsupported palette');
  const rosette = new Map<string, number>();
  for (let r = -S; r <= S; ++r) for (let q = -S; q <= S; ++q) {
    if (q % 32 !== 0 || r % 32 !== 0) continue;
    const dd = d2(q, r);
    if (dd < 400 || dd > (S - 8) * (S - 8)) continue;
    rosette.set(key(q, r), 0);
    NEIGHBORS.forEach((v, i) => rosette.set(key(q + v.q, r + v.r), i % 2 === 0 ? 1 : 0));
  }
  const colors = palette === 'DENSE_8' ? 8 : 4;
  const cells: OpticalCell[] = [];
  const byCoordinate = new Map<string, OpticalCell>();
  let dataCount = 0, alignmentCount = 0, calibrationCount = 0;
  for (let r = -S; r <= S; ++r) for (let q = -S; q <= S; ++q) {
    if (!isCandidate(q, r, S)) continue;
    const id = key(q, r);
    const structural = rosette.get(id);
    let role: OpticalCell['role'], colorIndex: number;
    if (structural !== undefined) {
      role = 'ALIGNMENT'; colorIndex = structural; ++alignmentCount;
    } else if (q % 8 === 0 && r % 8 === 0) {
      role = 'CALIBRATION';
      colorIndex = normMod(q / 8 + 5 * (r / 8), colors);
      ++calibrationCount;
    } else {
      role = 'DATA';
      // Deterministic PRNG experimental data pattern, not real payload encoding.
      let x = (seed ^ Math.imul(q, 0x9e3779b1) ^ Math.imul(r, 0x85ebca77)) >>> 0;
      x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15;
      colorIndex = (x >>> 0) % colors;
      ++dataCount;
    }
    const xy = axialToXY(q, r);
    const cell: OpticalCell = { q, r, role, colorIndex, ...xy };
    cells.push(cell); byCoordinate.set(id, cell);
  }
  return { S, palette, cells, dataCount, alignmentCount, calibrationCount, candidates: cells.length, byCoordinate };
}

export function estimateCapacity(layout: Layout, parity = 32): {
  codewordBytes: number; blocks: number; maximumPayloadBytes: number
} {
  const b = layout.palette === 'DENSE_8' ? 3 : 2;
  const C = Math.floor(layout.dataCount * b / 8);
  const B = Math.ceil(C / 255);
  const shortest = B ? Math.floor(C / B) : 0;
  return { codewordBytes: C, blocks: B, maximumPayloadBytes: B && shortest > parity ? C - B * parity - 20 : 0 };
}
