import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHybridSymbol, rasterize, detectHybridRaster,
  decodeHybridRasterRegions, centeredRegions, OmniMatrixError,
} from '@blcklab/omnimatrix';

// Simulate lowered screen contrast without knowing any DATA-cell values in the detector.
test('M9.2 moderate rim contrast still permits CRC-validated acquisition', () => {
  const symbol = encodeHybridSymbol(new Uint8Array(2048).fill(21), { S: 112 });
  const { image } = rasterize(symbol.layout, 900, 900, { header: symbol.header });
  for (let i=0;i<image.data.length;i+=3) {
    if (image.data[i]<50 && image.data[i+1]<50 && image.data[i+2]<50) {
      image.data[i]=image.data[i+1]=image.data[i+2]=100;
    }
  }
  const detected = detectHybridRaster(image, { sizes: [112] });
  assert.equal(detected.identification.detected?.S, 112);
  assert.ok(detected.rimScore < .68);
});

test('M9.2 CRC remains mandatory for low-contrast circles', () => {
  const blank = { width: 600, height: 600, data: new Uint8Array(600*600*3).fill(255) };
  const cx=300,cy=300;
  for (let y=0;y<600;y++) for(let x=0;x<600;x++) {
    const r = Math.hypot(x-cx,y-cy);
    if (r>246 && r<256) blank.data.fill(100,(y*600+x)*3,(y*600+x)*3+3);
  }
  assert.throws(()=>detectHybridRaster(blank,{sizes:[112]}),(err)=>err instanceof OmniMatrixError && ['INVALID_HEADER','INVALID_GEOMETRY'].includes(err.code));
});

test('M9.2 region fallback preserves confirmed ECC failure rather than later crop-geometry error', () => {
  const original=Uint8Array.from({length:1300},(_,i)=>i*73&255);
  const symbol=encodeHybridSymbol(original,{S:112});
  const damagedCells=symbol.layout.cells.map((c,i)=>
    c.role==='DATA' && i % 7 === 0 ? {...c,colorIndex:(c.colorIndex+3)%8}:c);
  const damagedLayout={...symbol.layout,cells:damagedCells,byCoordinate:new Map(damagedCells.map(c=>[`${c.q},${c.r}`,c]))};
  const image=rasterize(damagedLayout,980,980,{header:symbol.header}).image;
  assert.throws(()=>decodeHybridRasterRegions(image,{sizes:[112],regions:centeredRegions(980,980)}),
    (err)=>err instanceof OmniMatrixError && err.code==='ECC_UNRECOVERABLE');
});
