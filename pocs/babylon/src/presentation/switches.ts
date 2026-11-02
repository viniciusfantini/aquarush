// Chaves de painel desenhadas em CSS (estilos em index.html), no jeito dos painéis náuticos/aeronáuticos.
// A POSIÇÃO de uma chave elétrica é do piloto e não depende de energia; só o LED (a "espia") acende quando a
// função está de fato energizada — sem bateria a alavanca fica em ON e o LED apagado.
//  • `toggle` — alavanca de duas posições (inox, ponta esférica, porca sextavada, LED). Variantes: "red" (ponta
//    vermelha) e "guard" (capa de proteção vermelha que levanta: starter);
//  • `tri`    — alavanca de três posições (em cima / meio / embaixo), ex.: bomba de porão ON · OFF · AUTO;
//  • `rotary` — seletor rotativo de punho vermelho: chave geral de baterias e os REGISTROS de combustível;
//  • `ignKey` — chave de ignição de um motor: OFF · ON (autoteste) · START (com mola: volta para ON ao soltar);
//  • `pull`   — puxador de afogador (mecânico, sem LED);
//  • `rope`   — manete da corda de partida (motor de popa sem arranque elétrico) + botão de parada.
// Os painéis montam o HTML com estas funções e só aplicam o estado (`setToggle`/`setTri`/`setRotary`/`setKey`/
// `setPull`/`setRope`). O clicável é um <button data-<attr>="<valor>">; o painel decide a ação.

export interface Opt { v: string; l: string }

export interface ToggleSpec {
  attr: string; val: string;       // vira data-<attr>="<val>" no botão
  label: string; sub?: string;
  on?: string; off?: string;       // legendas gravadas (padrão ON / OFF)
  variant?: "" | "red" | "guard";
  num?: number;                    // número da etapa (painel da turbina)
  cls?: string;
}

const numTag = (n?: number) => (n ? `<i class="num">${n}</i>` : "");

export const toggle = (o: ToggleSpec): string =>
  `<button class="tg ${o.variant ?? ""} ${o.cls ?? ""}" data-${o.attr}="${o.val}" aria-label="${o.label}">
    ${numTag(o.num)}<span class="led"></span>
    <span class="plate"><em class="t">${o.on ?? "ON"}</em><span class="nut"></span><span class="lever"></span>${o.variant === "guard" ? `<span class="cover"></span>` : ""}<em class="b">${o.off ?? "OFF"}</em></span>
    <b>${o.label}</b>${o.sub ? `<small>${o.sub}</small>` : ""}</button>`;

export const tri = (attr: string, label: string, sub: string, top: Opt, mid: Opt, bot: Opt): string =>
  `<div class="tg tri" data-tri="${attr}" data-pos="m">
    <span class="led"></span>
    <span class="tri-box"><span class="plate"><span class="nut"></span><span class="lever"></span></span>
      <span class="tri-l"><i data-p="t">${top.l}</i><i data-p="m">${mid.l}</i><i data-p="b">${bot.l}</i></span>
      <button class="z zt" data-${attr}="${top.v}" aria-label="${label} ${top.l}"></button><button class="z zm" data-${attr}="${mid.v}" aria-label="${label} ${mid.l}"></button><button class="z zb" data-${attr}="${bot.v}" aria-label="${label} ${bot.l}"></button></span>
    <b>${label}</b><small>${sub}</small></div>`;

const dialOpts = (attr: string, label: string, opts: Opt[], span: number) => opts.map((o, i) => {
  const a = opts.length === 1 ? 0 : -span / 2 + (span * i) / (opts.length - 1);
  return `<button data-${attr}="${o.v}" data-a="${a}" style="--a:${a}deg" aria-label="${label} ${o.l}"><span>${o.l}</span></button>`;
}).join("");

export const rotary = (attr: string, label: string, sub: string, opts: Opt[], o: { num?: number; cls?: string } = {}): string => {
  const n = opts.length, span = n === 2 ? 90 : n > 4 ? 240 : 180;
  return `<div class="rot ${o.cls ?? ""}" data-rot="${attr}">${numTag(o.num)}
    <div class="dial"><div class="ring"></div>${dialOpts(attr, label, opts, span)}<div class="knob"><i></i></div></div>
    <b>${label}</b><small>${sub}</small></div>`;
};

/** Chave de ignição: os botões têm data-key="<motor>" e data-kpos="off|on|start" (START é momentâneo). */
export const ignKey = (idx: number, label: string, sub: string): string =>
  `<div class="rot ik" data-ik="${idx}">
    <div class="dial"><div class="ring"></div>${[["off", "OFF"], ["on", "ON"], ["start", "START"]].map(([v, l], i) => {
      const a = -60 + 60 * i;
      return `<button data-key="${idx}" data-kpos="${v}" data-a="${a}" style="--a:${a}deg" aria-label="${label} ${l}"><span>${l}</span></button>`;
    }).join("")}<div class="knob"><i></i></div></div>
    <span class="led"></span><b>${label}</b><small>${sub}</small></div>`;

export const pull = (attr: string, val: string, label: string, sub: string, cap = "CHOKE"): string =>
  `<button class="pp" data-${attr}="${val}" aria-label="${label}">
    <span class="pp-well"><span class="pp-shaft"></span><span class="pp-knob">${cap}</span></span>
    <em class="pp-st">EMPURRADO</em><b>${label}</b><small>${sub}</small></button>`;

/** Manete da corda de partida (data-rope) e o botão de parada (data-stop). */
export const rope = (label: string, sub: string): string =>
  `<div class="rp"><button class="rp-pull" data-rope="1" aria-label="puxar a corda">
      <span class="rp-cowl"><span class="rp-line"></span><span class="rp-grip">PUXE</span></span></button>
    <button class="rp-stop" data-stop="1" aria-label="parar o motor">STOP</button>
    <em class="pp-st rp-st">PARADO</em><b>${label}</b><small>${sub}</small></div>`;

// ---- atualização do estado (a cada quadro; só toca no DOM se mudou) ----
const cls = (el: Element, c: string, on: boolean) => { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); };
const txt = (el: HTMLElement | null, s: string) => { if (el && el.textContent !== s) el.textContent = s; };

/** Alavanca: `on` = posição; `lit` = LED aceso (a função energizada; padrão = a posição). */
export const setToggle = (root: HTMLElement, attr: string, val: string, on: boolean, lit = on): void => {
  for (const b of root.querySelectorAll<HTMLElement>(`.tg[data-${attr}="${val}"]`)) { cls(b, "on", on); cls(b, "lit", lit); }
};
/** Três posições: `armed` = LED âmbar (energizada mas parada); `run` = LED verde (girando). */
export const setTri = (root: HTMLElement, attr: string, v: string, armed: boolean, run: boolean): void => {
  const el = root.querySelector<HTMLElement>(`.tri[data-tri="${attr}"]`);
  if (!el) return;
  const z = el.querySelector<HTMLElement>(`.z[data-${attr}="${v}"]`);
  const pos = z?.classList.contains("zt") ? "t" : z?.classList.contains("zb") ? "b" : "m";
  if (el.dataset.pos !== pos) el.dataset.pos = pos;
  cls(el, "armed", armed && !run); cls(el, "run", run);
};
const turnKnob = (el: HTMLElement, b: HTMLElement | null) => {
  const tr = `rotate(${b?.dataset.a ?? "0"}deg)`;
  const knob = el.querySelector<HTMLElement>(".knob")!;
  if (knob.style.transform !== tr) knob.style.transform = tr;
  for (const o of el.querySelectorAll<HTMLElement>(".dial button")) cls(o, "on", o === b);
};
export const setRotary = (root: HTMLElement, attr: string, v: string): void => {
  const el = root.querySelector<HTMLElement>(`.rot[data-rot="${attr}"]`);
  if (el) turnKnob(el, el.querySelector<HTMLElement>(`button[data-${attr}="${v}"]`));
};
/** Chave de ignição: posição e a luz de "ignição energizada". */
export const setKey = (root: HTMLElement, idx: number, pos: string, lit: boolean): void => {
  const el = root.querySelector<HTMLElement>(`.ik[data-ik="${idx}"]`);
  if (!el) return;
  turnKnob(el, el.querySelector<HTMLElement>(`button[data-kpos="${pos}"]`));
  cls(el, "lit", lit); cls(el, "start", pos === "start");
};
export const setPull = (root: HTMLElement, attr: string, pulled: boolean): void => {
  for (const b of root.querySelectorAll<HTMLElement>(`.pp[data-${attr}]`)) {
    cls(b, "on", pulled);
    txt(b.querySelector<HTMLElement>(".pp-st"), pulled ? "PUXADO" : "EMPURRADO");
  }
};
export const setRope = (root: HTMLElement, state: "off" | "cranking" | "running"): void => {
  const el = root.querySelector<HTMLElement>(".rp");
  if (!el) return;
  cls(el, "pulling", state === "cranking"); cls(el, "running", state === "running");
  txt(el.querySelector<HTMLElement>(".rp-st"), state === "running" ? "FUNCIONANDO" : state === "cranking" ? "PUXANDO…" : "PARADO");
};
/** Lê se a chave está na posição ligada (para alternar no clique). */
export const isOn = (el: HTMLElement): boolean => el.classList.contains("on");

/**
 * Chave de ignição com mola: segurar START (mouse/toque) manda "start"; soltar em qualquer lugar manda "on".
 * Os outros botões da chave (OFF/ON) vão pelo clique normal do painel.
 */
export const bindKeySpring = (root: HTMLElement, set: (idx: number, pos: "off" | "on" | "start") => void): void => {
  let held = -1;
  root.addEventListener("pointerdown", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-kpos]");
    if (!b || b.dataset.kpos !== "start") return;
    held = Number(b.dataset.key); set(held, "start"); e.preventDefault();
  });
  const release = () => { if (held >= 0) { set(held, "on"); held = -1; } };
  addEventListener("pointerup", release); addEventListener("pointercancel", release); addEventListener("blur", release);
};

/**
 * Display de informação (estilo de display antigo, o tema vem do painel: LCD verde, VFD âmbar, LCD cinza, vidro).
 * A caixa tem tamanho FIXO; se o texto não couber ele rola de um lado para o outro, como num display de painel.
 */
export const setRd = (el: HTMLElement | null, text: string, warn = false): void => {
  if (!el) return;
  let sp = el.querySelector<HTMLElement>(":scope > span");
  if (!sp) { sp = document.createElement("span"); el.textContent = ""; el.appendChild(sp); }
  cls(el, "warn", warn);
  if (sp.textContent === text) return;
  sp.textContent = text;
  const over = sp.scrollWidth - el.clientWidth + 8;
  if (over > 2) {
    el.style.setProperty("--d", `${-over}px`);
    el.style.setProperty("--t", `${Math.max(2.5, over / 16).toFixed(1)}s`);
    cls(el, "scroll", true);
  } else cls(el, "scroll", false);
};

/** Lanterna de mão (bote: manual, a pilha — não é uma chave do painel). */
export const lantern = (attr: string, label: string, sub: string): string =>
  `<button class="lan" data-${attr}="1" aria-label="${label}"><span class="lan-beam"></span><span class="lan-head"><span class="lan-lens"></span></span><span class="lan-body"><span class="lan-btn"></span></span>
    <b>${label}</b><small>${sub}</small></button>`;
