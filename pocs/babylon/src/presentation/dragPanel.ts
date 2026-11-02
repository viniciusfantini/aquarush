// Janela arrastável pela barra de título (painéis do Y). A posição fica salva por navegador e sempre dentro da tela.

export const makeDraggable = (el: HTMLElement, head: HTMLElement, storageKey: string): void => {
  const place = (x: number, y: number) => {
    const w = el.offsetWidth || 560, h = el.offsetHeight || 300;
    const nx = Math.min(Math.max(4, x), innerWidth - w - 4), ny = Math.min(Math.max(4, y), innerHeight - Math.min(h, 120));
    el.style.left = `${nx}px`; el.style.top = `${ny}px`; el.style.right = "auto"; el.style.bottom = "auto";
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { x: number; y: number } | null;
    if (saved) requestAnimationFrame(() => place(saved.x, saved.y));
  } catch { /* sem storage */ }
  let drag: { dx: number; dy: number } | null = null;
  head.style.cursor = "grab"; head.style.touchAction = "none"; head.title = "arraste para mover";
  head.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return; // os botões do cabeçalho continuam clicáveis
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId); el.classList.add("dragging");
    e.preventDefault();
  });
  head.addEventListener("pointermove", (e) => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
  const end = () => {
    if (!drag) return;
    drag = null; el.classList.remove("dragging");
    const r = el.getBoundingClientRect();
    try { localStorage.setItem(storageKey, JSON.stringify({ x: r.left, y: r.top })); } catch { /* sem storage */ }
  };
  head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
  // ao redimensionar, só reposiciona um painel VISÍVEL (o escondido tem retângulo 0,0 e iria para o canto)
  addEventListener("resize", () => { if (!el.style.left || el.offsetWidth === 0) return; const r = el.getBoundingClientRect(); place(r.left, r.top); });
};
