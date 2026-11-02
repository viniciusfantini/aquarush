// Manetes de acelerador no painel do Y, uma por tipo de comando (CSS em index.html):
//  • "binnacle" — lancha AR-6 (motor de popa): manete única de topo, marcha + acelerador na mesma alavanca
//    (ré ← N → frente, com detentes em N e na lenta engrenada);
//  • "twin"     — AR-9 (dois V8): duas manetes lado a lado, bombordo (punho vermelho) e boreste (verde),
//    independentes — empuxo diferencial na mão;
//  • "tiller"   — bote AR-3 (cana): punho giratório do acelerador (tartaruga ↔ lebre) + alavanca de câmbio F-N-R
//    na lateral do motor;
//  • "turbine"  — AR-10: manete de potência em T num trilho reto (LENTA → MÁX) + alavanca de marcha F-N-R separada.
// ACELERAR EM NEUTRO, como nos barcos reais: na manete de topo (AR-6/AR-9) o botão "N" no meio do quadrante (o
// botão de neutro/aquecimento) só arma com a manete em N; armado, empurrar a manete só acelera, sem engatar, e ele
// desarma quando ela volta para N. Na cana e na turbina, o punho/potência em N acelera em neutro.
// O painel NÃO comanda a simulação: ele é mais um dispositivo de entrada — manda {marcha, acelerador, neutro} por motor
// para o InputManager, que monta o VehicleInput (contrato único). A posição mostrada é a da manete (o comando).

export type Gear = "F" | "N" | "R";
export interface LeverCmd { gear: Gear; throttle: number; neutral?: boolean }
export type LeverKind = "binnacle" | "twin" | "tiller" | "turbine";

const ARC = 50; // graus de curso da manete de topo para cada lado

/** posição p ∈ [−1, 1] da manete combinada ↔ comando (detente de N em |p| < 0,12; lenta engrenada até 0,2) */
const pToCmd = (p: number, neutralBtn: boolean): LeverCmd => {
  const a = Math.abs(p);
  if (a < 0.12) return { gear: "N", throttle: 0 };
  const thr = Math.min(1, Math.max(0, (a - 0.2) / 0.8));
  // botão de neutro armado: para a frente só acelera (a marcha fica em N); para trás não faz nada
  if (neutralBtn) return p > 0 ? { gear: "N", throttle: thr, neutral: true } : { gear: "N", throttle: 0 };
  return { gear: p > 0 ? "F" : "R", throttle: thr };
};
const cmdToP = (c: LeverCmd): number => {
  if (c.gear === "N") return c.neutral && c.throttle > 0 ? 0.2 + 0.8 * c.throttle : 0;
  return (c.gear === "F" ? 1 : -1) * (c.throttle <= 0.001 ? 0.17 : 0.2 + 0.8 * c.throttle);
};

const gearSel = (idx: number) => `<div class="gs" data-gs="${idx}"><span class="gs-slot"></span><span class="gs-knob"></span>
  ${(["F", "N", "R"] as Gear[]).map((g) => `<button data-lg="${idx}" data-gear="${g}">${g}</button>`).join("")}</div>`;

export class LeverControls {
  readonly el: HTMLElement;
  private readonly kind: LeverKind;
  private readonly n: number;
  private readonly onChange: (i: number, c: LeverCmd) => void;
  /** comando de cada manete enquanto o piloto a segura (mostrado no lugar do que vem do input) */
  private drag: (LeverCmd | null)[] = [];
  private shown: LeverCmd[] = [];
  /** botão de neutro armado (manete de topo) */
  private nBtn: boolean[] = [];

  constructor(kind: LeverKind, onChange: (i: number, c: LeverCmd) => void) {
    this.kind = kind; this.onChange = onChange;
    this.n = kind === "twin" ? 2 : 1;
    const el = document.createElement("div");
    el.className = `lev lev-${kind}`;
    if (kind === "binnacle" || kind === "twin") {
      const unit = (i: number, label: string, cls: string) => `<div class="mt" data-mt="${i}">
        <div class="mt-house"><span class="mt-arc"></span>
          <i class="mt-l r">R</i><button class="mt-nbtn" data-nb="${i}" title="botão de neutro: arme com a manete em N e empurre para acelerar sem engatar">N</button><i class="mt-l f">F</i>
          <span class="mt-arm ${cls}"><span class="mt-knob"></span></span><span class="mt-hub"></span></div>
        <em class="mt-rd rd"><span>N</span></em><b>${label}</b></div>`;
      el.innerHTML = kind === "twin"
        ? `${unit(0, "BOMBORDO", "port")}${unit(1, "BORESTE", "stbd")}<small class="lev-tip">arraste cada manete · clique no N para acelerar em neutro</small>`
        : `${unit(0, "MANETE", "")}<small class="lev-tip">arraste: F à direita · R à esquerda · clique no N para acelerar em neutro</small>`;
    } else if (kind === "tiller") {
      el.innerHTML = `<div class="tl"><div class="tl-grip" data-grip="0"><span class="tl-ridges"></span><span class="tl-mark"></span></div>
          <div class="tl-scale"><span>🐢 LENTO</span><span>RÁPIDO 🐇</span></div><em class="mt-rd rd"><span>N · 0 %</span></em><b>PUNHO DO ACELERADOR</b><small>gire (arraste para os lados) · em N acelera em neutro</small></div>
        <div class="tl-shift">${gearSel(0)}<b>CÂMBIO</b><small>no motor</small></div>`;
    } else {
      el.innerHTML = `<div class="pl"><div class="pl-track" data-pl="0"><span class="pl-slot"></span>
            <i class="pl-l max">MÁX</i><i class="pl-l idle">LENTA</i><span class="pl-handle"><span class="pl-t"></span></span></div>
          <em class="mt-rd rd"><span>N · 0 %</span></em><b>POTÊNCIA</b><small>manete em T (N1)</small></div>
        <div class="tl-shift">${gearSel(0)}<b>MARCHA</b><small>hidráulica: só engata com a turbina rodando</small></div>`;
    }
    this.el = el;
    for (let i = 0; i < this.n; i++) { this.drag.push(null); this.shown.push({ gear: "N", throttle: 0 }); this.nBtn.push(false); }
    this.bind();
  }

  private send(i: number, c: LeverCmd): void { this.drag[i] = c; this.onChange(i, c); this.paint(i, c); }

  /** punho da cana / potência da turbina: em N o acelerador vira aceleração em neutro */
  private withGear(gear: Gear, throttle: number): LeverCmd { return gear === "N" ? { gear, throttle, neutral: throttle > 0 } : { gear, throttle }; }

  private bind(): void {
    const el = this.el;
    // manete de topo: o ângulo do ponteiro em volta do pivô define a posição
    for (const house of el.querySelectorAll<HTMLElement>(".mt-house")) {
      const i = Number(house.parentElement!.dataset.mt);
      const at = (e: PointerEvent) => {
        const r = house.getBoundingClientRect();
        const px = r.left + r.width / 2, py = r.bottom - 16;
        const ang = (Math.atan2(e.clientX - px, py - e.clientY) * 180) / Math.PI;
        const c = pToCmd(Math.max(-1, Math.min(1, ang / ARC)), this.nBtn[i]);
        // o botão de neutro desarma quando a manete volta para N (como o botão real, que salta de volta)
        if (this.nBtn[i] && !c.neutral && c.gear === "N" && this.shown[i].neutral) this.nBtn[i] = false;
        this.send(i, c);
      };
      this.drag1(house, at, i, (e) => !(e.target as HTMLElement).closest(".mt-nbtn"));
    }
    // punho giratório: arrastar para os lados
    const grip = el.querySelector<HTMLElement>(".tl-grip");
    if (grip) {
      let x0 = 0, t0 = 0;
      grip.addEventListener("pointerdown", (e) => { x0 = e.clientX; t0 = this.shown[0].throttle; this.drag[0] = { ...this.shown[0] }; try { grip.setPointerCapture(e.pointerId); } catch { /* */ } e.preventDefault(); });
      grip.addEventListener("pointermove", (e) => {
        if (!this.drag[0] || e.buttons === 0) return;
        this.send(0, this.withGear(this.shown[0].gear, Math.max(0, Math.min(1, t0 + (e.clientX - x0) / 140))));
      });
      const up = () => { this.drag[0] = null; };
      grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
      grip.addEventListener("dblclick", () => this.send(0, this.withGear(this.shown[0].gear, 0)));
    }
    // manete de potência (trilho vertical)
    const track = el.querySelector<HTMLElement>(".pl-track");
    if (track) {
      const at = (e: PointerEvent) => {
        const r = track.getBoundingClientRect();
        const f = 1 - (e.clientY - r.top - 12) / (r.height - 24);
        this.send(0, this.withGear(this.shown[0].gear, Math.max(0, Math.min(1, f))));
      };
      this.drag1(track, at, 0);
    }
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      // botão de neutro (manete de topo): só arma com a manete em N
      const nb = t.closest<HTMLElement>("button[data-nb]");
      if (nb) {
        const i = Number(nb.dataset.nb);
        if (this.shown[i].gear !== "N") { nb.classList.add("deny"); setTimeout(() => nb.classList.remove("deny"), 400); return; }
        this.nBtn[i] = !this.nBtn[i];
        if (!this.nBtn[i]) this.send(i, { gear: "N", throttle: 0 }), this.drag[i] = null;
        this.paint(i, this.shown[i]);
        return;
      }
      // câmbio separado F-N-R (bote e turbina): como no motor real, só entra com o acelerador na lenta
      const b = t.closest<HTMLElement>("button[data-lg]");
      if (!b) return;
      const g = b.dataset.gear as Gear;
      this.onChange(0, { gear: g, throttle: 0 }); this.paint(0, { gear: g, throttle: 0 });
    });
  }

  private drag1(target: HTMLElement, at: (e: PointerEvent) => void, i: number, ok: (e: PointerEvent) => boolean = () => true): void {
    let active = false;
    target.addEventListener("pointerdown", (e) => {
      if (!ok(e)) return;
      active = true; try { target.setPointerCapture(e.pointerId); } catch { /* */ }
      e.preventDefault(); at(e);
    });
    target.addEventListener("pointermove", (e) => { if (active && e.buttons !== 0) at(e); });
    const up = () => { active = false; this.drag[i] = null; };
    target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
    target.addEventListener("dblclick", (e) => { if (ok(e as PointerEvent)) { this.nBtn[i] = false; this.send(i, { gear: "N", throttle: 0 }); } });
  }

  /** Mostra os comandos atuais (do InputManager); a manete que o piloto está segurando fica onde a mão está. */
  update(cmds: LeverCmd[]): void {
    for (let i = 0; i < this.n; i++) {
      const c = this.drag[i] ?? cmds[i] ?? cmds[0];
      const s = this.shown[i];
      // teclado (N + W) acelerando em neutro: o botão aparece armado
      if (c.neutral && c.throttle > 0 && !this.nBtn[i] && (this.kind === "binnacle" || this.kind === "twin")) this.nBtn[i] = true;
      if (c.gear !== s.gear || !!c.neutral !== !!s.neutral || Math.abs(c.throttle - s.throttle) > 0.004) this.paint(i, c);
    }
  }

  private paint(i: number, c: LeverCmd): void {
    this.shown[i] = { ...c };
    const el = this.el, pct = `${Math.round(c.throttle * 100)} %`;
    const txt = c.gear === "N" ? (c.neutral && c.throttle > 0 ? `N · ACEL ${pct}` : c.throttle > 0 ? `N · ${pct}` : "N") : `${c.gear} · ${pct}`;
    if (this.kind === "binnacle" || this.kind === "twin") {
      const u = el.querySelector<HTMLElement>(`.mt[data-mt="${i}"]`)!;
      u.querySelector<HTMLElement>(".mt-arm")!.style.transform = `rotate(${cmdToP(c) * ARC}deg)`;
      u.querySelector<HTMLElement>(".mt-rd span")!.textContent = txt;
      u.dataset.g = c.neutral && c.throttle > 0 ? "NA" : c.gear;
      u.querySelector<HTMLElement>(".mt-nbtn")!.classList.toggle("on", this.nBtn[i]);
      return;
    }
    if (this.kind === "tiller") {
      el.querySelector<HTMLElement>(".tl-ridges")!.style.backgroundPositionX = `${-c.throttle * 46}px`;
      el.querySelector<HTMLElement>(".tl-mark")!.style.left = `${8 + c.throttle * 84}%`;
    } else {
      el.querySelector<HTMLElement>(".pl-handle")!.style.bottom = `calc(${c.throttle * 100}% - ${c.throttle * 24}px)`;
    }
    el.querySelector<HTMLElement>(".mt-rd span")!.textContent = txt;
    const gs = el.querySelector<HTMLElement>(".gs")!;
    gs.dataset.pos = c.gear;
    for (const b of gs.querySelectorAll<HTMLElement>("button")) b.classList.toggle("on", b.dataset.gear === c.gear);
  }
}
