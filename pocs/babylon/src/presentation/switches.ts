// Chaves de painel desenhadas em CSS (estilos em index.html), no jeito dos painéis náuticos/aeronáuticos:
//  • `toggle` — alavanca de duas posições: haste de inox com ponta esférica sobre placa preta, porca sextavada,
//    LED de estado e as legendas da posição gravadas em cima/embaixo. Variantes: "red" (haste vermelha:
//    combustível) e "guard" (capa de proteção vermelha que levanta: starter);
//  • `tri`    — alavanca de três posições (em cima / meio / embaixo), ex.: bomba de porão ON · OFF · AUTO;
//  • `rotary` — seletor rotativo (chave geral de baterias), clicando na posição gravada em volta do botão;
//  • `pull`   — puxador de afogador: botão redondo que sai do painel e mostra a haste quando puxado.
// Os painéis montam o HTML com estas funções e só atualizam o estado (`setToggle`/`setTri`/`setRotary`/`setPull`).
// Clique: o elemento clicável é um <button> com `data-<attr>="<valor>"`; o painel decide a ação.

export interface Opt { v: string; l: string }

export interface ToggleSpec {
  attr: string; val: string;       // vira data-<attr>="<val>" no botão
  label: string; sub?: string;
  on?: string; off?: string;       // legendas gravadas (padrão ON / OFF)
  variant?: "" | "red" | "guard";
  num?: number;                    // número da etapa (painel da turbina)
  cls?: string;
}

export const toggle = (o: ToggleSpec): string =>
  `<button class="tg ${o.variant ?? ""} ${o.cls ?? ""}" data-${o.attr}="${o.val}" aria-label="${o.label}">
    ${o.num ? `<i class="num">${o.num}</i>` : ""}<span class="led"></span>
    <span class="plate"><em class="t">${o.on ?? "ON"}</em><span class="nut"></span><span class="lever"></span>${o.variant === "guard" ? `<span class="cover"></span>` : ""}<em class="b">${o.off ?? "OFF"}</em></span>
    <b>${o.label}</b>${o.sub ? `<small>${o.sub}</small>` : ""}</button>`;

export const tri = (attr: string, label: string, sub: string, top: Opt, mid: Opt, bot: Opt): string =>
  `<div class="tg tri" data-tri="${attr}" data-pos="m">
    <span class="led"></span>
    <span class="tri-box"><span class="plate"><span class="nut"></span><span class="lever"></span></span>
      <span class="tri-l"><i data-p="t">${top.l}</i><i data-p="m">${mid.l}</i><i data-p="b">${bot.l}</i></span>
      <button class="z zt" data-${attr}="${top.v}" aria-label="${label} ${top.l}"></button><button class="z zm" data-${attr}="${mid.v}" aria-label="${label} ${mid.l}"></button><button class="z zb" data-${attr}="${bot.v}" aria-label="${label} ${bot.l}"></button></span>
    <b>${label}</b><small>${sub}</small></div>`;

export const rotary = (attr: string, label: string, sub: string, opts: Opt[]): string => {
  const n = opts.length, span = n === 2 ? 90 : n > 4 ? 240 : 180;
  return `<div class="rot" data-rot="${attr}">
    <div class="dial"><div class="ring"></div>${opts.map((o, i) => {
      const a = -span / 2 + (span * i) / (n - 1);
      return `<button data-${attr}="${o.v}" data-a="${a}" style="--a:${a}deg" aria-label="${label} ${o.l}"><span>${o.l}</span></button>`;
    }).join("")}<div class="knob"><i></i></div></div>
    <b>${label}</b><small>${sub}</small></div>`;
};

export const pull = (attr: string, val: string, label: string, sub: string, cap = "CHOKE"): string =>
  `<button class="pp" data-${attr}="${val}" aria-label="${label}"><span class="led"></span>
    <span class="pp-well"><span class="pp-shaft"></span><span class="pp-knob">${cap}</span></span>
    <em class="pp-st">EMPURRADO</em><b>${label}</b><small>${sub}</small></button>`;

// ---- atualização do estado (a cada quadro; só toca no DOM se mudou) ----
const cls = (el: Element, c: string, on: boolean) => { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); };

export const setToggle = (root: HTMLElement, attr: string, val: string, on: boolean, onTxt?: string): void => {
  for (const b of root.querySelectorAll<HTMLElement>(`.tg[data-${attr}="${val}"]`)) {
    cls(b, "on", on);
    if (onTxt !== undefined) { const t = b.querySelector<HTMLElement>("em.t"); if (t && t.textContent !== onTxt) t.textContent = onTxt; }
  }
};
export const setTri = (root: HTMLElement, attr: string, v: string): void => {
  const el = root.querySelector<HTMLElement>(`.tri[data-tri="${attr}"]`);
  if (!el) return;
  const z = el.querySelector<HTMLElement>(`.z[data-${attr}="${v}"]`);
  const pos = z?.classList.contains("zt") ? "t" : z?.classList.contains("zb") ? "b" : "m";
  if (el.dataset.pos !== pos) el.dataset.pos = pos;
  cls(el, "on", pos !== "m");
};
export const setRotary = (root: HTMLElement, attr: string, v: string): void => {
  const el = root.querySelector<HTMLElement>(`.rot[data-rot="${attr}"]`);
  if (!el) return;
  const b = el.querySelector<HTMLElement>(`button[data-${attr}="${v}"]`);
  const tr = `rotate(${b?.dataset.a ?? "0"}deg)`;
  const knob = el.querySelector<HTMLElement>(".knob")!;
  if (knob.style.transform !== tr) knob.style.transform = tr;
  for (const o of el.querySelectorAll<HTMLElement>("button")) cls(o, "on", o === b);
  cls(el, "on", v !== "off");
};
export const setPull = (root: HTMLElement, attr: string, pulled: boolean): void => {
  for (const b of root.querySelectorAll<HTMLElement>(`.pp[data-${attr}]`)) {
    cls(b, "on", pulled);
    const st = b.querySelector<HTMLElement>(".pp-st")!, txt = pulled ? "PUXADO" : "EMPURRADO";
    if (st.textContent !== txt) st.textContent = txt;
  }
};
/** Lê se a chave está ligada (para alternar no clique). */
export const isOn = (el: HTMLElement): boolean => el.classList.contains("on");
