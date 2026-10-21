import type { HybridSymbol } from '../api/hybrid-symbol.js';
import { renderHybridSVG } from '../api/hybrid-symbol.js';

/** Presentation themes modify only the canvas OUTSIDE an unmodified white-backed optical SVG. */
export type ArtworkTheme = 'CORE' | 'ORBIT' | 'PRISM' | 'PEARL';

export interface ArtworkOptions {
  readonly theme?: ArtworkTheme;
  /** Square core resolution, in whole pixels. */
  readonly coreSize?: number;
}

const themes = {
  ORBIT: { background: '#f7faff', band: '#dceaf9', accent: '#aecbe5', caption: '#bccbdb' },
  PRISM: { background: '#faf8ff', band: '#efe4ff', accent: '#dacaf6', caption: '#c6bdda' },
  PEARL: { background: '#fcfcfa', band: '#eaece8', accent: '#cfd7d0', caption: '#c4ccc4' },
} as const;

/**
 * Decorative export in a bright, quiet, nonfunctional frame around a BYTE-IDENTICAL
 * core SVG. The data cells, their color values, bullseye and optical header tracks
 * are never modified. CORE is exactly renderHybridSVG's existing output.
 *
 * Other themes are presentation candidates, NOT independently field-validated
 * phone-scanning profiles. Verify the exported image before using it in production.
 */
export function renderHybridArtworkSVG(symbol: HybridSymbol, options: ArtworkOptions = {}): string {
  const { theme = 'CORE', coreSize = 1600 } = options;
  if (theme !== 'CORE' && theme !== 'ORBIT' && theme !== 'PRISM' && theme !== 'PEARL') {
    throw new RangeError('Unknown OmniMatrix artwork theme');
  }
  if (!Number.isSafeInteger(coreSize) || coreSize < 256 || coreSize > 4096) {
    throw new RangeError('Artwork coreSize must be an integer in [256,4096]');
  }
  const core = renderHybridSVG(symbol, coreSize);
  if (theme === 'CORE') return core;
  const preset = themes[theme];
  // Use a 7.5% optical margin and keep all accents outside the core's white rectangle.
  // Nested SVG uses the original viewBox, so every core cell keeps its exact geometry.
  const inner = core
    .replace(/^<svg[^>]*>/, `<svg x="120" y="155" width="960" height="960" viewBox="${-(symbol.layout.S + 14)} ${-(symbol.layout.S + 14)} ${2 * (symbol.layout.S + 14)} ${2 * (symbol.layout.S + 14)}">`)
    .replace(/<\/svg>\s*$/, '</svg>');
  const header = `<svg xmlns="http://www.w3.org/2000/svg" width="${coreSize}" height="${Math.round(coreSize * 1.18)}" viewBox="0 0 1200 1416">`;
  return [header,
    `<rect width="1200" height="1416" fill="${preset.background}"/>`,
    `<rect x="36" y="36" width="1128" height="1344" rx="54" fill="#ffffff"/>`,
    `<path d="M 88 96 H 1112" stroke="${preset.band}" stroke-width="8" stroke-linecap="round"/>`,
    `<rect x="104" y="139" width="992" height="992" rx="32" fill="#ffffff" stroke="${preset.band}" stroke-width="3"/>`,
    inner,
    `<path d="M 105 1190 H 1095" stroke="${preset.band}" stroke-width="3"/>`,
    `<text x="600" y="1274" text-anchor="middle" fill="${preset.caption}" font-size="41" letter-spacing="13" font-family="sans-serif" font-weight="700">OMNIMATRIX</text>`,
    `<circle cx="600" cy="1321" r="7" fill="${preset.accent}"/>`,
    '</svg>'
  ].join('\n');
}
