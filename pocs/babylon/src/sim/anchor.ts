// Âncora de proa: guincho (molinete elétrico na lancha, à mão no bote), cabo lançado e unhar no fundo.
//
//  • "+" paga cabo, "−" recolhe. Sem fundo a âncora pende da roldana de proa (desce com o cabo);
//    ao tocar o fundo ela fica parada ali e o cabo vira uma mola só de tração (como as amarras),
//    aplicada pela física do barco (Speedboat.anchor.line) — o barco gira e fica "na âncora".
//  • Poder de garra cresce com o filame (scope = cabo lançado ÷ profundidade): ~5:1 segura tudo;
//    com pouco cabo a força puxa a haste para cima e a âncora ARA o fundo ("garrar"), andando
//    na direção do barco enquanto a tração passar do que ela aguenta.
//  • Recolhendo com a âncora unhada o molinete puxa o barco até em cima dela; com o cabo mais curto que a
//    profundidade ela desunha e sobe. O molinete puxa corrente da bateria (cai com a tensão; sem força
//    só o relé estala, como no trim).
// Sem Babylon: roda no Node (tests/sim.test.ts, seção "âncora").

import { type Vec3, v3, sub, len, add, scale, clamp } from "./math.ts";
import type { AnchorParams } from "./params.ts";

export type AnchorState = "recolhida" | "descendo" | "subindo" | "no fundo" | "segurando" | "garrando";

export class AnchorGear {
  readonly p: AnchorParams;
  /** cabo lançado (m, medido da roldana de proa) */
  out = 0;
  state: AnchorState = "recolhida";
  /** posição da âncora no mundo */
  pos: Vec3 = v3();
  /** âncora apoiada no fundo (o cabo passa a segurar o barco) */
  onBottom = false;
  /** tração no cabo (N) — calculada pela física do barco no passo anterior */
  tension = 0;
  /** profundidade da roldana até o fundo, sob a âncora (m) */
  depth = 0;
  /** corrente do molinete (A) */
  motorA = 0;
  /** botão apertado mas o molinete sem força (bateria): só o relé estala */
  relay = false;
  /** quanto a âncora já arou o fundo (m) */
  dragged = 0;

  constructor(p: AnchorParams) { this.p = p; }

  reset(): void {
    this.out = 0; this.state = "recolhida"; this.onBottom = false; this.tension = 0; this.motorA = 0; this.relay = false; this.dragged = 0;
  }

  /** Filame (cabo ÷ profundidade). */
  get scope(): number { return this.depth > 0.1 ? this.out / this.depth : 0; }
  /** Força que a âncora aguenta com o filame atual (N). */
  get holdN(): number { return this.p.holdN * clamp((this.scope - 1.2) / 3.8, 0.1, 1); }
  /** Cabo para a física do barco (só com a âncora no fundo). */
  get line(): { anchor: Vec3; local: Vec3; length: number } | null {
    return this.onBottom ? { anchor: this.pos, local: this.p.roller, length: this.out } : null;
  }

  /**
   * @param cmd    +1 paga cabo, −1 recolhe
   * @param bow    roldana de proa no mundo
   * @param voltsOk o molinete tem força (sempre true no bote, que é à mão)
   * @param blocked barco na carretinha / virado: o guincho não opera
   */
  step(dt: number, cmd: number, bow: Vec3, ground: (x: number, z: number) => number, voltsOk: boolean, blocked: boolean): void {
    const P = this.p;
    this.relay = false; this.motorA = 0;
    let c = blocked ? 0 : clamp(cmd, -1, 1);
    if (Math.abs(c) < 0.05) c = 0;
    if (c !== 0 && P.motorA > 0 && !voltsOk) { this.relay = true; this.motorA = 1.5; c = 0; }
    const load = clamp(this.tension / Math.max(1, P.holdN), 0, 1);
    const before = this.out;
    if (c > 0) this.out = Math.min(P.rodeMax, this.out + P.rateOut * c * dt);
    else if (c < 0) this.out = Math.max(0, this.out + P.rateIn * c * dt * (1 - 0.5 * load)); // puxando o barco: mais devagar
    if (this.out !== before && P.motorA > 0) this.motorA = P.motorA * (c < 0 ? 1 + load : 0.45); // descendo quase solto

    if (!this.onBottom) {
      this.depth = Math.max(0, bow.y - ground(bow.x, bow.z));
      if (this.out <= 0.001) { this.out = 0; this.pos = { ...bow }; this.state = "recolhida"; this.tension = 0; return; }
      // pendurada sob a roldana, descendo com o cabo
      this.pos = v3(bow.x, bow.y - this.out, bow.z);
      const gy = ground(bow.x, bow.z);
      if (this.pos.y <= gy) { this.pos.y = gy; this.onBottom = true; this.state = "no fundo"; }
      else this.state = c < 0 ? "subindo" : "descendo";
      this.tension = 0;
      return;
    }
    const gy = ground(this.pos.x, this.pos.z);
    this.pos.y = gy;
    this.depth = Math.max(0.1, bow.y - gy);
    // recolhendo até o barco ficar sobre ela: com o cabo mais curto que a profundidade ela desunha e sobe
    if (c < 0 && this.out < this.depth + 0.3) { this.onBottom = false; this.state = "subindo"; this.tension = 0; return; }
    const hold = this.holdN;
    if (this.tension > hold) {
      // garrando: ara o fundo na direção do barco
      const d = sub(bow, this.pos), dh = Math.hypot(d.x, d.z);
      if (dh > 0.01) {
        const v = 0.6 * clamp(this.tension / hold - 1, 0.05, 2);
        this.pos = add(this.pos, scale(v3(d.x / dh, 0, d.z / dh), v * dt));
        this.dragged += v * dt;
      }
      this.state = "garrando";
    } else {
      const taut = len(sub(bow, this.pos)) >= this.out - 0.05;
      this.state = taut || this.tension > 0.05 * hold ? "segurando" : "no fundo";
    }
  }
}
