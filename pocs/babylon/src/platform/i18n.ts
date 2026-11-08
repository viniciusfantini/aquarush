// Idioma da interface. O jogo é escrito em pt-BR; em inglês, uma camada ÚNICA traduz tudo o que vai para a tela:
// textos do DOM (textContent/innerHTML/title, HUD, painéis, avisos, menu, ajuda, os relógios SVG) e os letreiros 3D
// desenhados em canvas (fillText) — sem espalhar chamadas de tradução pelo código. Dicionário em i18n.en.ts.
// Escolha: botão de idioma no splash (grava `aquarush.lang` e recarrega) ou `?lang=en|pt` na URL.

import { EN } from "./i18n.en.ts";

export type Lang = "pt" | "en";

const detect = (): Lang => {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "en" || q === "pt") return q;
    return localStorage.getItem("aquarush.lang") === "en" ? "en" : "pt";
  } catch { return "pt"; }
};
export const LANG: Lang = typeof location !== "undefined" ? detect() : "pt";

/** troca o idioma e recarrega (a cena 3D tem letreiros desenhados na carga) */
export const setLang = (l: Lang): void => {
  try { localStorage.setItem("aquarush.lang", l === "en" ? "en" : "pt-BR"); } catch { /* sem storage */ }
  const u = new URL(location.href); u.searchParams.delete("lang");
  location.replace(u.toString());
};

// ---- dicionário: exatos + padrões com "{}" ----
const EXACT = new Map<string, string>();
const PATTERNS: { re: RegExp; out: string }[] = [];
// as mesmas chaves em CAIXA ALTA (o HUD mostra alguns textos em maiúsculas: "PILOTO ÚNICO")
const UPPER = new Map<string, string>();
const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
for (const [k, v] of Object.entries(EN)) {
  if (!k.includes("{}")) { EXACT.set(k, v); if (k.toUpperCase() !== k) UPPER.set(k.toUpperCase(), v.toUpperCase()); continue; }
  PATTERNS.push({ re: new RegExp("^" + k.split("{}").map((p) => esc(p).replace(/[{}]/g, "\\$&")).join("([\\s\\S]*?)") + "$"), out: v });
}
// padrões mais longos primeiro (mais específicos)
PATTERNS.sort((a, b) => b.re.source.length - a.re.source.length);
// palavras do português que aparecem nas chaves: um texto sem nenhuma delas não precisa de tradução (filtro rápido)
const VOCAB = new Set<string>();
for (const k of Object.keys(EN)) for (const w of k.toLowerCase().match(/[a-zà-ú]{2,}/g) ?? []) VOCAB.add(w);

const cache = new Map<string, string>();
const missing = new Set<string>();

const fill = (out: string, caps: string[]): string => {
  let i = 0;
  return out.replace(/\{(\d*)\}/g, (_, n: string) => tr(caps[n === "" ? i++ : Number(n)] ?? ""));
};

const translate = (s: string): string => {
  const ex = EXACT.get(s) ?? UPPER.get(s);
  if (ex !== undefined) return ex;
  for (const p of PATTERNS) {
    const m = p.re.exec(s);
    if (m) return fill(p.out, m.slice(1));
  }
  // composto: partes separadas por " · ", " — " ou um espaço entre rótulo e posição (aria-label "BOMBA PORÃO ON")
  for (const sep of [" · ", " — "]) {
    if (s.includes(sep)) {
      const parts = s.split(sep);
      const t = parts.map((x) => tr(x));
      if (t.some((x, i) => x !== parts[i])) return t.join(sep);
    }
  }
  const sp = s.lastIndexOf(" ");
  if (sp > 0) {
    const a = s.slice(0, sp), b = s.slice(sp + 1), ta = EXACT.get(a) ?? UPPER.get(a);
    if (ta !== undefined) return ta + " " + (EXACT.get(b) ?? UPPER.get(b) ?? b);
  }
  return s;
};

/** Traduz um texto da interface (pt → idioma atual). Mantém os espaços das pontas. */
export const tr = (s: string): string => {
  if (LANG === "pt" || !s) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  let r = s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  const core = m[2];
  const words = core.toLowerCase().match(/[a-zà-ú]{2,}/g);
  if (core && words && words.some((w) => VOCAB.has(w))) {
    const t = translate(core);
    r = m[1] + t + m[3];
    if (t === core && /[à-úÀ-Ú]|\b(de|do|da|com|sem|para|não|em)\b/i.test(core)) missing.add(core);
  }
  if (cache.size > 6000) cache.clear();
  cache.set(s, r);
  return r;
};

/** HTML: traduz os textos entre as tags e os atributos title / aria-label / placeholder. */
const trHtml = (html: string): string => {
  if (!/[a-zà-ú]{2,}/i.test(html)) return html;
  if (!html.includes("<")) return tr(html);
  return html
    .replace(/(^|>)([^<]+)(?=<|$)/g, (_, a: string, t: string) => a + (t.trim() ? tr(t.replace(/&gt;/g, ">")).replace(/>/g, "&gt;") : t))
    .replace(/\b(title|aria-label|placeholder)="([^"]*)"/g, (_, a: string, v: string) => `${a}="${tr(v)}"`);
};

/** Liga a tradução automática (só em inglês): DOM estático, escritas futuras no DOM e textos desenhados em canvas. */
export const installI18n = (): void => {
  if (LANG === "pt" || typeof document === "undefined") return;
  document.documentElement.lang = "en";
  const tcD = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
  Object.defineProperty(Node.prototype, "textContent", {
    configurable: true, enumerable: tcD.enumerable,
    get() { return tcD.get!.call(this); },
    set(v: string | null) {
      // <style>/<script> passam direto
      const tag = (this as Element).tagName;
      if (typeof v === "string" && tag !== "STYLE" && tag !== "SCRIPT") {
        v = tr(v);
        if (tcD.get!.call(this) === v) return; // nada mudou: não mexe no DOM
      }
      tcD.set!.call(this, v);
    },
  });
  const ihD = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: true, enumerable: ihD.enumerable,
    get() { return ihD.get!.call(this); },
    set(v: string) { ihD.set!.call(this, typeof v === "string" && (this as Element).tagName !== "STYLE" ? trHtml(v) : v); },
  });
  const tiD = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "title")!;
  Object.defineProperty(HTMLElement.prototype, "title", {
    configurable: true, enumerable: tiD.enumerable,
    get() { return tiD.get!.call(this); },
    set(v: string) { tiD.set!.call(this, tr(v)); },
  });
  const setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n: string, v: string) {
    return setAttr.call(this, n, n === "title" || n === "aria-label" || n === "placeholder" ? tr(String(v)) : v);
  };
  // letreiros 3D (DynamicTexture → canvas 2D)
  const C = CanvasRenderingContext2D.prototype;
  const fillText = C.fillText, strokeText = C.strokeText, measureText = C.measureText;
  C.fillText = function (t: string, x: number, y: number, w?: number) { return w === undefined ? fillText.call(this, tr(String(t)), x, y) : fillText.call(this, tr(String(t)), x, y, w); };
  C.strokeText = function (t: string, x: number, y: number, w?: number) { return w === undefined ? strokeText.call(this, tr(String(t)), x, y) : strokeText.call(this, tr(String(t)), x, y, w); };
  C.measureText = function (t: string) { return measureText.call(this, tr(String(t))); };
  // DOM estático do index.html
  const walk = (root: Node) => {
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = it.currentNode as Node | null; n; n = it.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const p = n.parentElement?.tagName;
        if (p === "STYLE" || p === "SCRIPT") continue;
        const v = n.nodeValue ?? "", t = tr(v);
        if (t !== v) n.nodeValue = t;
      } else {
        const e = n as Element;
        for (const a of ["title", "aria-label", "placeholder"]) { const v = e.getAttribute(a); if (v) e.setAttribute(a, v); }
      }
    }
  };
  walk(document.body);
  document.title = tr(document.title);
  // ajuda para achar o que ainda não tem tradução (console): textos com cara de português que passaram direto
  (window as unknown as { __i18nMissing: () => string[] }).__i18nMissing = () => {
    walk(document.body);
    const out = new Set(missing);
    const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) { const v = (n.nodeValue ?? "").trim(); if (v && /[à-úÀ-Ú]|\b(de|do|da|com|sem|para|não|em|o|a)\b/.test(v)) out.add(v); }
    return [...out];
  };
};
