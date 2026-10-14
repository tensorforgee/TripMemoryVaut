// Bounded live resource check. URLs, response bodies and credentials never reach output.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
const require = createRequire(import.meta.url);
require(require.resolve('@expo/env', { paths: [dirname(require.resolve('expo/package.json'))] }))
  .load(process.cwd(), { silent: true });
const agent = 'com.tripmemoryvault.app/basemap-probe';
let failures = 0;
async function resource(value, label, json = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'api.maptiler.com' || url.username || url.password) {
      throw new Error('Unsupported resource origin');
    }
    const response = await fetch(url, { headers: { 'User-Agent': agent, 'Cache-Control': 'no-cache' },
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      console.log(`${label}: HTTP ${response.status}`); failures++; return null;
    }
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error('Empty resource');
    const data = json ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
    console.log(`${label}: HTTP ${response.status}, ${bytes.byteLength} bytes`);
    return data;
  } catch {
    console.log(`${label}: FAILED (invalid resource, network, timeout or body; details withheld)`);
    failures++; return null;
  }
}
try {
  const url = new URL(process.env.EXPO_PUBLIC_MAP_STYLE_URL);
  if (url.pathname !== '/maps/streets-v4/style.json' || !url.searchParams.get('key')) throw new Error();
  const style = await resource(url, 'Streets V4 style', true);
  if (style?.version !== 8 || !style?.layers?.length) throw new Error();
  console.log(`Style: version 8, ${style.layers.length} layers`);
  const sprites = typeof style.sprite === 'string' ? [style.sprite] : (style.sprite ?? []).map(s => s.url);
  for (const [index, sprite] of sprites.entries()) {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
      const target = new URL(sprite); target.pathname += suffix;
      await resource(target, `Sprite ${index + 1} ${suffix}`, suffix.endsWith('.json'));
    }
  }
  const fonts = new Set();
  for (const layer of style.layers) {
    const font = layer.layout?.['text-font'];
    if (Array.isArray(font) && font.every(f => typeof f === 'string')) fonts.add(font.join(','));
  }
  console.log(`Static font stacks: ${fonts.size}`);
  for (const [index, font] of [...fonts].entries()) {
    await resource(style.glyphs.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', '0-255'), `Glyph stack ${index + 1}`);
  }
  for (const [index, source] of Object.values(style.sources).entries()) {
    if (typeof source.data === 'string') await resource(source.data, `Source ${index + 1} data`, true);
    const tilejson = source.url ? await resource(source.url, `Source ${index + 1} TileJSON`, true) : source;
    if (!tilejson) continue;
    const credit = tilejson.attribution ?? source.attribution ?? '';
    console.log(`Source ${index + 1} attribution: MapTiler=${/maptiler/i.test(credit)}, OpenStreetMap=${/openstreetmap/i.test(credit)}`);
    for (const z of [8, 11, 14]) {
      // Public sample viewport: Chandigarh. No archive coordinates are read.
      const x = Math.floor((76.7794 + 180) / 360 * 2 ** z);
      const lat = 30.7333 * Math.PI / 180;
      const y = Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * 2 ** z);
      const target = tilejson.tiles?.[0]?.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      if (target) await resource(target, `Source ${index + 1} tile z${z}`);
    }
  }
  if (!sprites.length || !fonts.size) { console.log('Missing sprite/font coverage'); failures++; }
} catch {
  console.log('Invalid Streets V4 configuration or style structure; credential and response withheld.'); failures++;
}
console.log(failures ? `Resource verification FAILED: ${failures} checks` : 'Resource verification PASSED (host HTTP checks; not native rendering evidence)');
process.exitCode = failures ? 1 : 0;
