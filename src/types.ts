/** M1 research types. Not a stable public API or a production optical protocol. */
export type PaletteName = 'RELIABLE_4' | 'DENSE_8';
export type CellRole = 'DATA' | 'ALIGNMENT' | 'CALIBRATION';
export interface RGB { readonly r: number; readonly g: number; readonly b: number }
export interface Axial { readonly q: number; readonly r: number }
export interface OpticalCell extends Axial {
  readonly role: CellRole;
  /** Full actual color index for calibration/data; ALIGNMENT uses black index 0 or white index 1. */
  readonly colorIndex: number;
  readonly x: number;
  readonly y: number;
}
export interface Layout {
  readonly S: number;
  readonly palette: PaletteName;
  readonly cells: readonly OpticalCell[];
  readonly dataCount: number;
  readonly alignmentCount: number;
  readonly calibrationCount: number;
  readonly candidates: number;
  readonly byCoordinate: ReadonlyMap<string, OpticalCell>;
}
export interface Raster { readonly width: number; readonly height: number; readonly data: Uint8Array }
export interface Transform {
  /** Position of symbol center in output raster, in image pixels. */
  readonly cx: number;
  readonly cy: number;
  /** Image pixels per hexagon circumradius. */
  readonly a: number;
  /** Clockwise angle in radians, positive y points down. */
  readonly rotation: number;
  readonly mirror?: boolean;
}
export interface SampleResult {
  readonly total: number;
  readonly errors: number;
  readonly accuracy: number;
  readonly confusion: number[][];
  readonly calibrationCount: number;
  readonly classCounts: readonly number[];
  readonly perColorErrors: readonly number[];
  readonly meanConfidenceMargin: number;
  readonly invalidSamples: number;
}
