import { cubeRound, key } from '../geometry.js';
import { headerBit, makeHeader, readHeader } from '../header.js';
import type { Layout, PaletteName, Raster, RGB, Transform } from '../types.js';

const HEX8 = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00'] as const;
const HEX4 = ['#000000', '#ffffff', '#ff0000', '#0000ff'] as const;
export function hexPalette(profile: PaletteName): readonly string[] { return profile === 'DENSE_8' ? HEX8 : HEX4; }
export function rgbPalette(profile: PaletteName): RGB[] {
  return hexPalette(profile).map(h => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }));
}
export const BLACK: RGB = { r: 0, g: 0, b: 0 };
export const WHITE: RGB = { r: 255, g: 255, b: 255 };
export function angleDeg(x: number, y: number): number {
  return ((Math.atan2(y, x) * 180 / Math.PI) % 360 + 360) % 360;
}
export function inGap(t: number): boolean {
  return t <= 7 || t >= 353 || (t >= 118 && t <= 122);
}
/** Optional validated bootstrap header for real payload symbols; omitted for legacy M1 research patterns. */
function resolvedHeader(layout: Layout, opticalHeader?: Uint8Array): Uint8Array {
  if (opticalHeader === undefined) return makeHeader({ S: layout.S, palette: layout.palette === 'DENSE_8' ? 1 : 0 });
  const parsed = readHeader(opticalHeader);
  if (parsed.S !== layout.S || parsed.palette !== (layout.palette === 'DENSE_8' ? 1 : 0)) {
    throw new RangeError('Optical header does not match rendered lattice');
  }
  return opticalHeader;
}
export function sampleIdeal(layout: Layout, x: number, y: number, opticalHeader?: Uint8Array): RGB {
  const rho = Math.hypot(x, y), S = layout.S;
  if (rho <= 8) {
    if (rho <= 2 || (rho > 4 && rho <= 6)) return BLACK;
    return WHITE;
  }
  if (rho > S + 8 && rho <= S + 10) return inGap(angleDeg(x, y)) ? WHITE : BLACK;
  if ((rho >= S + 2 && rho <= S + 4) || (rho >= S + 5 && rho <= S + 7)) {
    const i = Math.min(63, Math.floor(angleDeg(x, y) / (360 / 64)));
    const h = resolvedHeader(layout, opticalHeader);
    const bit = headerBit(h, i);
    const trackA = rho <= S + 4;
    return (trackA ? bit === 1 : bit === 0) ? BLACK : WHITE;
  }
  if (rho < 8 || rho > S) return WHITE;
  const cr = cubeRound(x, y);
  const cell = layout.byCoordinate.get(key(cr.q, cr.r));
  if (!cell) return WHITE;
  return rgbPalette(layout.palette)[cell.colorIndex] ?? WHITE;
}

/** Pixel-center sampler: no Canvas/DOM dependence. Nearest-neighbor ideal symbol geometry. */
export function rasterize(layout: Layout, width: number, height: number, options: {
  rotation?: number; mirror?: boolean; cx?: number; cy?: number; a?: number; header?: Uint8Array
} = {}): { image: Raster; transform: Transform } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 24_000_000) throw new RangeError('Image dimensions invalid');
  const transform: Transform = {
    a: options.a ?? Math.min(width, height) / (2 * (layout.S + 14)),
    cx: options.cx ?? width / 2, cy: options.cy ?? height / 2,
    rotation: options.rotation ?? 0, mirror: options.mirror ?? false,
  };
  const palette = rgbPalette(layout.palette);
  const colors = new Uint8Array((width * height) * 3);
  const cos = Math.cos(transform.rotation), sin = Math.sin(transform.rotation);
  const header = resolvedHeader(layout, options.header);
  // Optimization: avoid expensive palette/header allocation per pixel.
  for (let py = 0; py < height; ++py) {
    for (let px = 0; px < width; ++px) {
      const X = (px + 0.5 - transform.cx) / transform.a, Y = (py + 0.5 - transform.cy) / transform.a;
      let x = cos * X + sin * Y, y = -sin * X + cos * Y;
      if (transform.mirror) x = -x;
      const rho = Math.hypot(x, y), S = layout.S;
      let rgb: RGB = WHITE;
      if (rho <= 8) {
        rgb = (rho <= 2 || (rho > 4 && rho <= 6)) ? BLACK : WHITE;
      } else if (rho > S + 8 && rho <= S + 10) {
        rgb = inGap(angleDeg(x, y)) ? WHITE : BLACK;
      } else if ((rho >= S + 2 && rho <= S + 4) || (rho >= S + 5 && rho <= S + 7)) {
        const i = Math.min(63, Math.floor(angleDeg(x, y) / (360 / 64)));
        const bit = headerBit(header, i);
        rgb = (rho <= S + 4 ? bit === 1 : bit === 0) ? BLACK : WHITE;
      } else if (rho >= 8 && rho <= S) {
        const cr = cubeRound(x, y);
        const cell = layout.byCoordinate.get(key(cr.q, cr.r));
        if (cell) rgb = palette[cell.colorIndex] ?? WHITE;
      }
      const j = (py * width + px) * 3;
      colors[j] = rgb.r; colors[j + 1] = rgb.g; colors[j + 2] = rgb.b;
    }
  }
  return { image: { width, height, data: colors }, transform };
}
function xyAngle(radius: number, angle: number): string {
  return `${(radius * Math.cos(angle)).toFixed(5)} ${(radius * Math.sin(angle)).toFixed(5)}`;
}
function annulusPath(r0: number, r1: number, t0: number, t1: number): string {
  const sweep = t1 - t0;
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${xyAngle(r0,t0)} L ${xyAngle(r1,t0)} A ${r1} ${r1} 0 ${large} 1 ${xyAngle(r1,t1)} L ${xyAngle(r0,t1)} A ${r0} ${r0} 0 ${large} 0 ${xyAngle(r0,t0)} Z`;
}
function annulusFragments(r0: number, r1: number, a: number, b: number): string {
  // No full-circle arcs (SVG A cannot draw one), so split.
  const mid = (a + b) / 2;
  return `${annulusPath(r0, r1, a, mid)} ${annulusPath(r0, r1, mid, b)}`;
}
export function renderSVG(layout: Layout, pixelSize = 1024, opticalHeader?: Uint8Array): string {
  if (pixelSize <= 0 || !Number.isFinite(pixelSize)) throw new RangeError('Invalid SVG size');
  const extent = layout.S + 14;
  const head = resolvedHeader(layout, opticalHeader);
  const palette = hexPalette(layout.palette);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="${-extent} ${-extent} ${2*extent} ${2*extent}">`,
    `<rect x="${-extent}" y="${-extent}" width="${2*extent}" height="${2*extent}" fill="#ffffff"/>`,
    `<circle r="6" fill="#000000"/><circle r="4" fill="#ffffff"/><circle r="2" fill="#000000"/>`];
  // Axial cell vertices use k*pi/3; 0° points along +x.
  for (const cell of layout.cells) {
    const points = Array.from({ length: 6 }, (_, k) => {
      const angle = k * Math.PI / 3;
      return `${(cell.x + Math.cos(angle)).toFixed(5)},${(cell.y + Math.sin(angle)).toFixed(5)}`;
    }).join(' ');
    const color = cell.role === 'ALIGNMENT' ? (cell.colorIndex === 0 ? '#000000' : '#ffffff') : palette[cell.colorIndex];
    out.push(`<polygon points="${points}" fill="${color}"/>`);
  }
  for (let i = 0; i < 64; i++) {
    const bit = headerBit(head, i);
    const from = i * Math.PI / 32, to = (i + 1) * Math.PI / 32;
    if (bit === 1) out.push(`<path fill="#000000" d="${annulusPath(layout.S+2, layout.S+4,from,to)}"/>`);
    else out.push(`<path fill="#000000" d="${annulusPath(layout.S+5, layout.S+7,from,to)}"/>`);
  }
  // Black perimeter except orientation notches: [7,118], [122,353] degrees.
  const rad = (v: number) => v * Math.PI / 180;
  out.push(`<path fill="#000000" d="${annulusFragments(layout.S+8, layout.S+10,rad(7),rad(118))} ${annulusFragments(layout.S+8,layout.S+10,rad(122),rad(353))}"/>`);
  out.push('</svg>');
  return out.join('\n');
}
