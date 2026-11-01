// Renderiza o AudioWorklet do motor fora do navegador (Node) e mede nível e espectro.
// Uso: node tests/engine-audio.check.mjs  → também grava WAVs em tests/out/ para ouvir.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const SR = 48000;
let Proc = null;
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null }; } };
globalThis.registerProcessor = (_n, c) => { Proc = c; };
new Function(readFileSync(new URL("../src/presentation/engineWorklet.js", import.meta.url), "utf8"))();

const render = (params, seconds) => {
  const p = new Proc();
  p.port.onmessage({ data: { ...params, volume: 1 } });
  Object.assign(p, { rpm: params.rpm, load: params.load, comb: params.combustion, wet: params.wet, vol: 1 });
  const out = new Float32Array(SR * seconds);
  for (let i = 0; i < out.length; i += 128) {
    const buf = new Float32Array(128);
    p.process([], [[buf]]);
    out.set(buf.subarray(0, Math.min(128, out.length - i)), i);
  }
  return out;
};
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
// espectro grosseiro por DFT em faixas de 5 Hz até 1 kHz
const peak = (a) => {
  const N = 16384, seg = a.subarray(a.length - N);
  let best = 0, bestF = 0;
  for (let f = 10; f <= 1000; f += 2) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const w = 2 * Math.PI * f * n / SR; re += seg[n] * Math.cos(w); im += seg[n] * Math.sin(w); }
    const m = Math.hypot(re, im);
    if (m > best) { best = m; bestF = f; }
  }
  return bestF;
};
// centroide espectral (Hz): "brilho" do som — 2 tempos em lenta é bem mais agudo que 4 tempos
const centroid = (a) => {
  const N = 8192, seg = a.subarray(a.length - N);
  let num = 0, den = 0;
  for (let f = 20; f <= 4000; f += 20) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const w = 2 * Math.PI * f * n / SR; re += seg[n] * Math.cos(w); im += seg[n] * Math.sin(w); }
    const m = Math.hypot(re, im); num += f * m; den += m;
  }
  return num / den;
};
const wav = (name, a) => {
  const b = Buffer.alloc(44 + a.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + a.length * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(a.length * 2, 40);
  for (let i = 0; i < a.length; i++) b.writeInt16LE(Math.max(-1, Math.min(1, a[i])) * 32000, 44 + i * 2);
  mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./out/${name}.wav`, import.meta.url), b);
};
const cases = [
  ["lenta_750rpm", { rpm: 750, load: 0, combustion: 1, wet: 1 }],
  ["cruzeiro_3500rpm", { rpm: 3500, load: 0.5, combustion: 1, wet: 1 }],
  ["toda_5600rpm", { rpm: 5600, load: 1, combustion: 1, wet: 1 }],
  ["partida_250rpm", { rpm: 250, load: 0, combustion: 0, wet: 1 }],
];
let ok = true;
for (const [name, p] of cases) {
  const a = render(p, 2);
  const bad = a.some((x) => !Number.isFinite(x));
  const r = rms(a), f = peak(a);
  console.log(`${name.padEnd(18)} rms=${r.toFixed(3)} centroide=${centroid(a).toFixed(0)} Hz pico=${f} Hz (queima esperada ${(p.rpm / 30).toFixed(0)} Hz) ${bad ? "NaN!" : ""}`);
  if (bad || r < 0.005 || r > 0.9) ok = false;
  wav(name, a);
}
console.log(ok ? "OK" : "FALHA");
process.exitCode = ok ? 0 : 1;
