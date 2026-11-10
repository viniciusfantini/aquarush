# Gera docs/diagramas/AR-10_diagrama_eletrico.pdf — esquema elétrico e de controle da lancha de turbina AR-10,
# fiel à simulação da POC 1 (pocs/babylon/src/sim: engineSystems.ts, turbine.ts, boat.ts, params.ts).
# Rodar:  python docs/diagramas/gerar_ar10_eletrico.py      (precisa de: pip install reportlab)
# Os valores elétricos da simulação estão em "equivalente 12 V"; aqui aparecem em valores REAIS de 24 V
# (tensão × 2, corrente ÷ 2), como no HUD do jogo. Ao mudar a lógica no código, atualize este script.

import os
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "AR-10_diagrama_eletrico.pdf")
VERSION = "POC Babylon v0.68.5"
DATE = "2026-11-10"

FONT_DIR = r"C:\Windows\Fonts"
pdfmetrics.registerFont(TTFont("Sans", os.path.join(FONT_DIR, "arial.ttf")))
pdfmetrics.registerFont(TTFont("SansB", os.path.join(FONT_DIR, "arialbd.ttf")))
pdfmetrics.registerFont(TTFont("Mono", os.path.join(FONT_DIR, "consola.ttf")))

W, H = landscape(A3)
M = 26  # margem

# cores dos fios
POWER = colors.HexColor("#c62828")     # +24 V permanente / barramento
SWITCHED = colors.HexColor("#ef6c00")  # +24 V chaveado (depois de disjuntor/relé)
GROUND = colors.HexColor("#212121")    # negativo / massa
SIGNAL = colors.HexColor("#1565c0")    # sinal de sensor
CONTROL = colors.HexColor("#6a1b9a")   # comando (bobinas, saídas do FADEC)
MECH = colors.HexColor("#7b8a8b")      # ligação mecânica
WATER = colors.HexColor("#00838f")     # água / óleo (processo)
INK = colors.HexColor("#1b1f24")
SOFT = colors.HexColor("#5f6b75")
FILL = colors.HexColor("#f4f7f9")
FILL2 = colors.HexColor("#fff8e1")
FILL3 = colors.HexColor("#e8f5e9")
FILL4 = colors.HexColor("#ede7f6")


class Sheet:
    def __init__(self, c: canvas.Canvas):
        self.c = c

    # ---------- texto ----------
    def text(self, x, y, s, size=8, font="Sans", color=INK, anchor="l"):
        c = self.c
        c.setFillColor(color); c.setFont(font, size)
        if anchor == "c": c.drawCentredString(x, y, s)
        elif anchor == "r": c.drawRightString(x, y, s)
        else: c.drawString(x, y, s)

    def lines(self, x, y, items, size=7.5, lead=None, font="Sans", color=INK, anchor="l"):
        lead = lead or size * 1.28
        for i, s in enumerate(items):
            bold = s.startswith("**")
            self.text(x, y - i * lead, s.strip("*"), size, "SansB" if bold else font, color, anchor)

    # ---------- fios ----------
    def wire(self, pts, color=POWER, w=1.4, dash=None, dots=True):
        c = self.c
        c.setStrokeColor(color); c.setLineWidth(w)
        c.setDash(*(dash or ()))
        p = c.beginPath(); p.moveTo(*pts[0])
        for q in pts[1:]: p.lineTo(*q)
        c.drawPath(p, stroke=1, fill=0)
        c.setDash()
        if dots:
            c.setFillColor(color)
            for q in (pts[0], pts[-1]): c.circle(q[0], q[1], 1.6, stroke=0, fill=1)

    def junction(self, x, y, color=POWER):
        self.c.setFillColor(color); self.c.circle(x, y, 2.4, stroke=0, fill=1)

    def wlabel(self, x, y, s, color=SOFT, size=6.5, anchor="l"):
        self.text(x, y, s, size, "Sans", color, anchor)

    # ---------- blocos ----------
    def box(self, x, y, w, h, title=None, body=(), fill=FILL, stroke=INK, size=7.2, tsize=8.5, r=4, lw=1):
        c = self.c
        c.setFillColor(fill); c.setStrokeColor(stroke); c.setLineWidth(lw)
        c.roundRect(x, y, w, h, r, stroke=1, fill=1)
        ty = y + h - 11
        if title:
            self.text(x + 6, ty, title, tsize, "SansB")
            ty -= tsize * 1.35
        self.lines(x + 6, ty, body, size)

    def tag(self, x, y, s, fill=INK, color=colors.white, size=6.8):
        c = self.c
        w = pdfmetrics.stringWidth(s, "SansB", size) + 6
        c.setFillColor(fill); c.roundRect(x, y - 2.5, w, size + 4, 2, stroke=0, fill=1)
        self.text(x + 3, y, s, size, "SansB", color)
        return w

    # ---------- símbolos ----------
    def ground(self, x, y):
        c = self.c
        c.setStrokeColor(GROUND); c.setLineWidth(1.3)
        c.line(x, y, x, y - 7)
        for i, half in enumerate((7, 4.5, 2)):
            c.line(x - half, y - 7 - i * 2.6, x + half, y - 7 - i * 2.6)

    def battery(self, x, y, label, sub):
        """célula vertical: + em cima (y+14), − embaixo (y−14)"""
        c = self.c
        c.setStrokeColor(INK); c.setLineWidth(1.2)
        c.line(x, y + 14, x, y + 5); c.line(x, y - 5, x, y - 14)
        c.setLineWidth(2.2); c.line(x - 11, y + 5, x + 11, y + 5)      # placa +
        c.setLineWidth(4); c.line(x - 6, y + 1, x + 6, y + 1)          # placa −
        c.setLineWidth(2.2); c.line(x - 11, y - 3, x + 11, y - 3)
        c.setLineWidth(4); c.line(x - 6, y - 7 + 2, x + 6, y - 7 + 2)
        self.text(x + 15, y + 8, "+", 8, "SansB", POWER)
        self.text(x + 15, y - 11, "−", 8, "SansB", GROUND)
        self.text(x - 16, y + 3, label, 7.5, "SansB", INK, "r")
        self.text(x - 16, y - 6, sub, 6.6, "Sans", SOFT, "r")

    def contact(self, x, y, label, closed=False, horizontal=True, color=INK):
        """contato NA entre (x−12,y) e (x+12,y)"""
        c = self.c
        c.setStrokeColor(color); c.setLineWidth(1.3)
        c.setFillColor(colors.white)
        c.circle(x - 10, y, 2, stroke=1, fill=1); c.circle(x + 10, y, 2, stroke=1, fill=1)
        if closed: c.line(x - 8, y, x + 8, y)
        else: c.line(x - 8, y, x + 7, y + 8)
        if label: self.text(x, y + 11, label, 6.8, "SansB", color, "c")

    def relay(self, x, y, name, desc, coil_note):
        """contator: contato de potência na horizontal (x−12..x+12, y) + bobina embaixo"""
        self.contact(x, y, name)
        c = self.c
        c.setStrokeColor(CONTROL); c.setLineWidth(0.9); c.setDash(2, 2)
        c.line(x, y - 2, x, y - 16); c.setDash()
        c.setFillColor(FILL4); c.rect(x - 9, y - 27, 18, 11, stroke=1, fill=1)
        c.setLineWidth(0.8); c.line(x - 9, y - 27, x + 9, y - 16)
        self.text(x, y - 36, desc, 6.3, "SansB", CONTROL, "c")
        if coil_note: self.lines(x, y - 44, coil_note, 5.9, color=SOFT, anchor="c")

    def breaker(self, x, y, label):
        """disjuntor na horizontal entre x−9 e x+9"""
        c = self.c
        c.setStrokeColor(INK); c.setLineWidth(1.1); c.setFillColor(colors.white)
        c.rect(x - 8, y - 3.5, 16, 7, stroke=1, fill=1)
        c.line(x - 8, y, x + 8, y)
        self.text(x, y + 6, label, 5.8, "Sans", SOFT, "c")

    def round_device(self, x, y, letter, r=11, fill=colors.white, color=INK, size=9):
        c = self.c
        c.setStrokeColor(color); c.setLineWidth(1.2); c.setFillColor(fill)
        c.circle(x, y, r, stroke=1, fill=1)
        self.text(x, y - size * 0.35, letter, size, "SansB", color, "c")

    def lamp(self, x, y, r=6, fill=colors.white):
        c = self.c
        c.setStrokeColor(INK); c.setLineWidth(1); c.setFillColor(fill)
        c.circle(x, y, r, stroke=1, fill=1)
        d = r * 0.7
        c.line(x - d, y - d, x + d, y + d); c.line(x - d, y + d, x + d, y - d)

    def sensor(self, x, y, code, name, detail, w=150):
        c = self.c
        c.setStrokeColor(SIGNAL); c.setLineWidth(1.1); c.setFillColor(colors.HexColor("#e3f2fd"))
        c.roundRect(x, y - 15, w, 30, 3, stroke=1, fill=1)
        self.round_device(x + 13, y, code, r=9, color=SIGNAL, size=7)
        self.text(x + 27, y + 3, name, 7.2, "SansB")
        self.text(x + 27, y - 7, detail, 6.1, "Sans", SOFT)

    def actuator(self, x, y, code, name, detail, w=158, fill=FILL4, color=CONTROL):
        c = self.c
        c.setStrokeColor(color); c.setLineWidth(1.1); c.setFillColor(fill)
        c.roundRect(x, y - 15, w, 30, 3, stroke=1, fill=1)
        self.round_device(x + w - 13, y, code, r=9, color=color, size=6.5)
        self.text(x + 6, y + 3, name, 7.2, "SansB")
        self.text(x + 6, y - 7, detail, 6.1, "Sans", SOFT)

    # ---------- moldura e carimbo ----------
    def frame(self, n, total, title, subtitle, short=None):
        c = self.c
        c.setStrokeColor(INK); c.setLineWidth(1.6); c.rect(M - 8, M - 8, W - 2 * (M - 8), H - 2 * (M - 8))
        c.setLineWidth(0.5); c.rect(M - 4, M - 4, W - 2 * (M - 4), H - 2 * (M - 4))
        # carimbo
        bw, bh = 360, 62
        bx, by = W - M - bw, M
        c.setFillColor(colors.white); c.setLineWidth(1.2); c.rect(bx, by, bw, bh, stroke=1, fill=1)
        c.setLineWidth(0.6)
        c.line(bx, by + 40, bx + bw, by + 40); c.line(bx, by + 20, bx + bw, by + 20)
        c.line(bx + 250, by, bx + 250, by + 40); c.line(bx + 130, by, bx + 130, by + 20)
        self.text(bx + 6, by + 46, "AQUA RUSH · LANCHA DE TURBINA AR-10", 9.5, "SansB")
        self.text(bx + 6, by + 26, short or title, 8.5, "SansB")
        self.text(bx + 256, by + 26, f"FOLHA {n}/{total}", 8.5, "SansB")
        self.text(bx + 6, by + 6, VERSION, 7, "Sans", SOFT)
        self.text(bx + 136, by + 6, f"Data {DATE}", 7, "Sans", SOFT)
        self.text(bx + 256, by + 6, "Sistema 24 V CC", 7, "Sans", SOFT)
        # título da folha
        self.text(M + 2, H - M - 14, title, 15, "SansB")
        self.text(M + 2, H - M - 28, subtitle, 8.5, "Sans", SOFT)

    def legend(self, x, y):
        items = [(POWER, 2.4, None, "+24 V permanente / barramento"), (SWITCHED, 1.6, None, "+24 V chaveado (pós disjuntor/relé)"),
                 (GROUND, 1.4, None, "negativo / massa"), (CONTROL, 1.1, (3, 2), "comando (bobinas, saídas do FADEC)"),
                 (SIGNAL, 1.1, None, "sinal de sensor"), (MECH, 1.4, (6, 3), "ligação mecânica"), (WATER, 2, (1, 2), "água / óleo (processo)")]
        self.text(x, y, "LEGENDA", 7.5, "SansB")
        for i, (col, w, dash, s) in enumerate(items):
            yy = y - 12 - i * 10
            self.wire([(x, yy + 2), (x + 26, yy + 2)], col, w, dash, dots=False)
            self.text(x + 32, yy, s, 6.6, "Sans", INK)


# =====================================================================================================
# FOLHA 1 — distribuição de energia 24 V
# =====================================================================================================
def sheet1(s: Sheet):
    s.frame(1, 3, "DISTRIBUIÇÃO DE ENERGIA 24 V — FONTES, BARRAMENTO E CARGAS",
            "Esquema unifilar fiel à simulação (engineSystems.ts / boat.ts / turbine.ts). Valores reais de 24 V (a simulação calcula em equivalente 12 V: tensão × 2, corrente ÷ 2).",
            "Distribuição de energia 24 V")
    c = s.c
    BUS_X0, BUS_Y0, BUS_Y1 = 520, 300, 600   # barramento: barra vertical de y0 a y1

    # ---------------- baterias + seletor ----------------
    s.box(40, 560, 240, 205, "BANCO DE BATERIAS", (
        "2 × 12 V 75 Ah em SÉRIE = 24 V 75 Ah",
        "(simulação: 150 Ah equivalente 12 V)",
        "chumbo-ácido: 25,4 V cheia → ~20,4 V zerada",
        "resistência interna sobe com a descarga",
        "partida a 60 %: ~19 V no barramento",
        "carga pelo gerador/GPU até ~20 A",
    ), fill=FILL2)
    bx = 110
    s.battery(bx, 640, "BAT 1", "12 V 75 Ah")
    s.battery(bx, 600, "BAT 2", "12 V 75 Ah")
    s.wire([(bx, 626), (bx, 614)], INK, 1.2, dots=False)      # série
    s.wire([(bx, 654), (bx, 660), (215, 660)], POWER, 2.4)
    s.wire([(bx, 586), (bx, 580)], GROUND, 1.6, dots=False); s.ground(bx, 580)
    s.text(150, 665, "+24 V", 7, "SansB", POWER)
    # seletor rotativo OFF / BUS / BOTH
    s.round_device(232, 660, "", r=17, fill=colors.white)
    c.setStrokeColor(colors.HexColor("#b71c1c")); c.setLineWidth(3); c.line(232, 660, 245, 671)
    s.text(209, 642, "OFF", 6.3, "SansB", SOFT, "c"); s.text(232, 636, "BUS", 6.3, "SansB", SOFT, "c"); s.text(256, 642, "BOTH", 6.3, "SansB", SOFT, "c")
    s.text(232, 625, "SELETOR", 6.6, "SansB", INK, "c")
    s.wire([(249, 660), (330, 660)], POWER, 2.4, dots=False)
    s.lines(292, 596, ["SELETOR:  OFF  → barramento isolado (nada entra)", "          BUS  → baterias fora; só GPU / gerador", "          BOTH → baterias no barramento (24 V)"], 6.4, color=SOFT)
    # fusível principal ANL + contator de bateria K1 + shunt
    c.setStrokeColor(INK); c.setFillColor(colors.white); c.setLineWidth(1.2); c.rect(330, 654, 24, 12, stroke=1, fill=1)
    c.line(330, 660, 354, 660); s.text(342, 671, "F1 ANL", 6.3, "SansB", INK, "c")
    s.wire([(354, 660), (388, 660)], POWER, 2.4, dots=False)
    s.relay(400, 660, "K1", "CONTATOR DE BATERIA", ["bobina: MAIN ligada E", "seletor em BOTH"])
    s.wire([(412, 660), (470, 660), (470, 560), (BUS_X0, 560)], POWER, 2.4)
    c.setStrokeColor(INK); c.setFillColor(colors.white); c.rect(434, 654, 16, 12, stroke=1, fill=1)
    s.text(442, 671, "SH1", 6, "SansB", INK, "c"); s.text(442, 645, "→ BAT A", 5.8, "Sans", SOFT, "c")

    # ---------------- GPU da doca ----------------
    s.box(40, 365, 240, 180, "GPU DA DOCA (fonte de solo)", (
        "gerador a diesel 28 V num carrinho no píer",
        "estados: OFF → STARTING (4,5 s) → ONLINE",
        "         → STOPPING (4 s sem carga) → OFF",
        "fonte firme: 28 V, 2,5 mΩ (não descarrega)",
        "só conecta ATRACADO na vaga do píer (J)",
        "sai da vaga = o cabo solta sozinho",
        "carrega as baterias e dá partida fria",
    ), fill=FILL3)
    s.round_device(240, 400, "G", r=13, fill=colors.white)
    s.text(240, 378, "diesel 28 V", 6.2, "Sans", SOFT, "c")
    s.wire([(253, 400), (300, 400)], POWER, 2.4)
    c.setStrokeColor(INK); c.setFillColor(colors.white); c.setLineWidth(1.2)
    c.rect(300, 392, 18, 16, stroke=1, fill=1); c.line(306, 396, 306, 404); c.line(312, 396, 312, 404)
    s.text(309, 414, "J1 TOMADA", 6.3, "SansB", INK, "c")
    s.text(309, 381, "cabo (tecla J)", 5.8, "Sans", SOFT, "c")
    s.wire([(318, 400), (388, 400)], POWER, 2.4, dots=False)
    s.relay(400, 400, "K3", "CONTATOR EXT PWR", ["fecha: GPU ONLINE E EXT PWR", "E MAIN / seletor ≠ OFF", "FADEC: automático · MANUAL: chave"])
    s.wire([(412, 400), (470, 400), (470, 460), (BUS_X0, 460)], POWER, 2.4)
    c.setStrokeColor(INK); c.setFillColor(colors.white); c.rect(434, 394, 16, 12, stroke=1, fill=1)
    s.text(442, 411, "SH2", 6, "SansB", INK, "c"); s.text(442, 385, "→ GPU A", 5.8, "Sans", SOFT, "c")

    # ---------------- starter-gerador ----------------
    s.box(40, 120, 240, 230, "STARTER-GERADOR (na turbina)", (
        "máquina única 28 V no eixo do gerador de gás (N1)",
        "STARTER: motor ~175 A, leva o N1 até ~24 %",
        "  sai a 45 % N1 (FADEC); no manual ninguém corta",
        "  > 40 s ligado: térmico desarma, trava 60 s",
        "  esquecido > 60 % N1 aquece 4× mais rápido",
        "GERADOR: 28 V, até 60 A (80 % já na marcha lenta)",
        "  só gera com o STARTER desligado",
    ), fill=FILL2)
    s.round_device(240, 225, "SG", r=15, fill=colors.white, size=8)
    s.wire([(240, 210), (240, 160)], GROUND, 1.4, dots=False); s.ground(240, 160)
    # geração: SG -> K2 -> barramento
    s.wire([(255, 233), (300, 233), (300, 262), (388, 262)], POWER, 2.4)
    s.relay(400, 262, "K2", "RELÉ DO GERADOR (GCU)", ["fecha: chave GERADOR E", "STARTER desligado E barram. ON"])
    s.wire([(412, 262), (505, 262), (505, 320), (BUS_X0, 320)], POWER, 2.4)
    s.text(340, 268, "geração →", 6.2, "SansB", POWER, "c")
    # partida: barramento -> K4 -> SG
    s.wire([(BUS_X0 + 7, BUS_Y0), (BUS_X0 + 7, 186), (412, 186)], POWER, 2.4)
    s.relay(400, 186, "K4", "CONTATOR DO STARTER", ["bobina: chave STARTER", "(FADEC: só na partida)"])
    s.wire([(388, 186), (300, 186), (300, 217), (255, 217)], SWITCHED, 2.2)
    s.text(340, 192, "← partida", 6.2, "SansB", SWITCHED, "c")

    # ---------------- BARRAMENTO PRINCIPAL ----------------
    c.setFillColor(POWER); c.rect(BUS_X0, BUS_Y0, 14, BUS_Y1 - BUS_Y0, stroke=0, fill=1)
    s.text(BUS_X0 + 7, BUS_Y1 + 18, "BARRAMENTO PRINCIPAL", 7.5, "SansB", POWER, "c")
    s.text(BUS_X0 + 7, BUS_Y1 + 9, "24 V CC", 7.5, "SansB", POWER, "c")
    for yy in (560, 460, 320): s.junction(BUS_X0, yy)
    s.round_device(BUS_X0 - 32, 510, "V", r=10)
    s.wire([(BUS_X0 - 22, 510), (BUS_X0, 510)], SIGNAL, 1, dots=False)
    s.text(BUS_X0 - 32, 492, "BARRAM. V", 6, "SansB", INK, "c")
    s.text(BUS_X0 - 32, 484, "16–32 V", 5.8, "Sans", SOFT, "c")

    # ---------------- CARGAS ----------------
    LX = 600
    loads = [
        ("CB1", "FADEC / instrumentos / anunciadores", "~0,75 A · ligado sempre que o barramento tem tensão", "F"),
        ("CB2", "Bomba de combustível (BOOST)", "~8 A · chave BOMBA COMB. · acima de 45 % N1 a bomba do motor basta", "M"),
        ("CB3", "Excitatriz de ignição (2 velas)", "~3 A · chave IGNIÇÃO · 'tic-tic' ~4 por segundo", "IG"),
        ("CB4", "Válvula de corte de combustível (solenoide NF)", "~0,8 A · chave COMBUSTÍVEL · sem tensão por 0,3 s → FECHA (apaga)", "SV"),
        ("CB5", "Bomba da transmissão (trim UP/DN)", "15 A movendo · 22 A no batente · sem força (< ~18 V sob carga): só o relé", "M"),
        ("CB6", "Molinete da âncora (pagar / recolher)", "~35 A · relé + / −", "M"),
        ("CB7", "Bomba de porão 1500 GPH", "~2,75 A · ON / OFF / AUTO (boia > 6 L, < 0,5 L)", "M"),
        ("CB8", "Luzes de navegação + painel", "~1,25 A com as luzes · 0,15 A só o painel", "L"),
        ("CB9", "Buzina", "elétrica (tom cai com a tensão)", "B"),
        ("CB10", "Alarme master caution + TESTE", "óleo quente, falha EXT PWR, teste de lâmpadas", "A"),
    ]
    top = BUS_Y1 - 14
    for i, (cb, name, det, sym) in enumerate(loads):
        y = top - i * 30
        s.wire([(BUS_X0 + 14, y), (LX - 9, y)], POWER, 1.6, dots=False)
        s.junction(BUS_X0 + 14, y)
        s.breaker(LX, y, cb)
        s.wire([(LX + 9, y), (LX + 40, y)], SWITCHED, 1.4, dots=False)
        if sym == "L": s.lamp(LX + 52, y, 7)
        else: s.round_device(LX + 52, y, sym, r=10, size=7 if len(sym) > 1 else 8.5)
        s.wire([(LX + 62, y), (LX + 70, y)], GROUND, 1.1, dots=False)
        s.text(LX + 76, y + 2, name, 7.2, "SansB")
        s.text(LX + 76, y - 7, det, 6, "Sans", SOFT)
    s.text(LX + 76, top + 26, "CARGAS DO BARRAMENTO (corrente real a 24 V)", 8, "SansB")
    s.text(LX + 76, top + 16, "(massa comum no negativo das baterias — omitida por clareza)", 6.2, "Sans", SOFT)

    # ---------------- instrumentos e lógica ----------------
    s.box(LX, 140, 330, 92, "INSTRUMENTOS ELÉTRICOS (painel Y e HUD)", (
        "BARRAM. V — tensão do barramento (16–32 V; verde 24–29,5)",
        "BAT A (shunt SH1) — + carga / − consumo (−30…+15 A)",
        "GPU A (shunt SH2) — corrente da fonte de solo (0–600 A)",
        "Luzes: BAT (descarregando) · GERADOR (fora do barramento)",
        "       EXT PWR âmbar = GPU disponível · vermelho = FALHA",
    ), fill=FILL, size=6.6)
    s.box(960, 140, 205, 92, "LÓGICA DO BARRAMENTO", (
        "busOn   = MAIN e seletor ≠ OFF",
        "bateria = busOn e seletor = BOTH",
        "GPU     = ONLINE e EXT PWR e busOn",
        "gerador = GERADOR e não STARTER",
        "          e busOn e turbina girando",
    ), fill=FILL4, size=6.6)

    # ---------------- comandos (chaves) ----------------
    s.box(960, 420, 205, 300, "CHAVES DO PAINEL (Y)", (
        "MAIN (eletrônicos) — mestre do barramento",
        "SELETOR — OFF / BUS / BOTH",
        "EXT PWR — relé da GPU (K3)",
        "BOMBA COMB. — boost (CB2)",
        "STARTER — contator K4 (capa vermelha)",
        "IGNIÇÃO — excitatriz (CB3)",
        "COMBUSTÍVEL — CORTE / LENTA (solenoide)",
        "GERADOR — relé K2",
        "GOV — governador do N2",
        "TANQUE — registro (mecânico)",
        "BOMBA PORÃO — ON / OFF / AUTO",
        "START (AUTO-START) / STOP — FADEC",
        "TESTE — lâmpadas + alarme",
        "BUZINA · TRIM ▲▼ · MANETE · MARCHA",
        "",
        "**Posição ≠ energia:",
        "a chave fica onde o piloto deixou;",
        "o LED (espia) só acende com a",
        "função de fato energizada.",
    ), fill=FILL4, size=6.7)
    s.legend(960, 390)


# =====================================================================================================
# FOLHA 2 — turbina, FADEC, sensores e atuadores
# =====================================================================================================
def sheet2(s: Sheet):
    s.frame(2, 3, "TURBINA, FADEC, SENSORES E ATUADORES",
            "Turbina a gás de eixo livre ~1100 shp: gerador de gás (N1) + turbina livre (N2 → redução 2,4:1 → hélice de superfície). O FADEC é uma camada que aciona as MESMAS chaves do painel e protege.",
            "Turbina, FADEC e sensores")
    c = s.c
    FX, FY, FW, FH = 470, 250, 250, 420
    s.box(FX, FY, FW, FH, "FADEC / ECU DA TURBINA", (
        "Alimentação: barramento 24 V (CB1) — funciona",
        "com tensão > 6 V de qualquer fonte.",
        "",
        "**Partida automática (START / P):",
        "1. confere barramento e combustível",
        "2. BOMBA COMB. ON, STARTER ON → N1 sobe",
        "3. N1 ≥ 12 %: IGNIÇÃO ON + COMBUSTÍVEL LENTA",
        "4. acende (light-off): EGT sobe, N1 acelera",
        "5. N1 ≥ 45 %: STARTER e IGNIÇÃO OFF",
        "6. marcha lenta N1 62 %: GERADOR ON",
        "   (~21 s; GPU: EXT PWR abre sozinho)",
        "",
        "**Proteções (só no FADEC):",
        "• partida quente: EGT > 780 °C → corta",
        "• partida pendurada: N1 não chega → aborta",
        "• sem acendimento → aborta",
        "• starter > 60 % N1 → desliga",
        "",
        "**Governador do N2 (FADEC ou chave GOV):",
        "limita ~103,5 %, antecipação acima de 97 %,",
        "corte rápido de combustível acima de ~104 %",
        "",
        "**MANUAL: mexer em qualquer chave (≠ MAIN)",
        "passa a partida ao piloto — nada protege.",
        "START devolve ao FADEC.",
    ), fill=FILL4, size=6.9, tsize=10, lw=1.6)

    # ---------- sensores (entradas) ----------
    sensors = [
        ("N1", "N1 — gerador de gás", "pickup magnético · 0–110 % (marcha lenta 62 %)"),
        ("N2", "N2 — turbina livre", "pickup · 100 % = 6000 rpm · > 106 % = sobrevelocidade"),
        ("EGT", "EGT — temperatura do escape", "termopares · lenta ~480 °C · alerta > 720 · limite partida 780"),
        ("TQ", "Torque do eixo de saída", "0–120 % · verde até 100 %"),
        ("OP", "Pressão do óleo", "transdutor 0–100 psi · verde 45–85"),
        ("OT", "Temperatura do óleo", "alarme 110 °C · dano dos mancais > 120 °C"),
        ("FQ", "Quantidade de combustível", "boia do tanque · 900 L"),
        ("V", "Tensão do barramento", "medida interna do FADEC"),
        ("HP", "Pressão hidráulica da caixa reversora", "sem turbina rodando = sem pressão = não engata"),
        ("PLA", "Manete de potência + marcha F/N/R", "posição da manete (0–100 %) e alavanca de marcha"),
        ("FL", "Chama no escape", "luz CHAMA (fogo visível na saída)"),
    ]
    sx = 60
    for i, (code, name, det) in enumerate(sensors):
        y = FY + FH - 20 - i * 37
        s.sensor(sx, y, code, name, det, w=300)
        s.wire([(sx + 300, y), (FX, y if FY < y < FY + FH else FY + 10)], SIGNAL, 1.1)
    s.text(sx, FY + FH + 12, "SENSORES (ENTRADAS DO FADEC)", 9, "SansB", SIGNAL)

    # ---------- atuadores (saídas) ----------
    acts = [
        ("K4", "Contator do STARTER", "liga o starter-gerador no modo motor"),
        ("IG", "Excitatriz de ignição", "2 velas · só acende com N1 ≥ ~12 %"),
        ("SV", "Válvula de corte (solenoide NF)", "sem tensão por 0,3 s: fecha e apaga"),
        ("BP", "Bomba de combustível (boost)", "pressão até a bomba do motor assumir"),
        ("FMV", "Válvula dosadora (governador)", "combustível pela manete; limita o N2"),
        ("K2", "Relé do gerador (GCU)", "gerador no barramento na marcha lenta"),
        ("K3", "Contator EXT PWR (automático)", "fecha GPU estável · abre na marcha lenta"),
        ("ANN", "Anunciadores (10 luzes)", "ver folha 3"),
        ("AL", "Alarme master caution", "óleo quente · falha EXT PWR · teste"),
    ]
    ax = 790
    for i, (code, name, det) in enumerate(acts):
        y = FY + FH - 20 - i * 44
        s.actuator(ax, y, code, name, det, w=230)
        s.wire([(FX + FW, y), (ax, y)], CONTROL, 1.2, (3, 2))
    s.text(ax, FY + FH + 12, "ATUADORES (SAÍDAS / COMANDOS)", 9, "SansB", CONTROL)

    # ---------- trem mecânico e resfriamento ----------
    by = 150
    s.box(60, by - 40, 400, 98, "TREM DE POTÊNCIA", (
        "gerador de gás (N1) ──gás── turbina livre (N2) → caixa de redução 2,4:1",
        "→ transmissão de superfície (trim/tilt) → hélice de superfície (~2500 rpm a 100 %)",
        "caixa reversora HIDRÁULICA: embreagens a óleo, bomba acionada pelo motor",
        "→ sem a turbina rodando não engata e solta a marcha (volta a N)",
        "starter-gerador e bomba de óleo na caixa de acessórios do gerador de gás",
    ), fill=FILL, size=6.8)
    s.box(480, by - 40, 290, 98, "RESFRIAMENTO DO ÓLEO (sem corte automático)", (
        "bomba de água do mar MECÂNICA (acessórios; vazão segue o N1)",
        "~3 L/s a 100 % N1, só com a tomada submersa",
        "→ trocadores de calor do óleo da turbina e da caixa",
        "→ saída no espelho (bombordo), jato visível",
        "fora d'água o óleo esquenta: alarme 110 °C, dano > 120 °C",
    ), fill=colors.HexColor("#e0f7fa"), size=6.8)
    s.wire([(460, by + 10), (480, by + 10)], MECH, 1.4, (6, 3), dots=False)
    s.wire([(625, by + 58), (625, FY)], WATER, 2, (1, 2), dots=False)
    s.text(630, by + 75, "temperatura do óleo → OT", 6.2, "Sans", WATER)

    # ---------- chaves do painel → FADEC ----------
    s.box(790, by - 40, 230, 98, "CHAVES → FADEC", (
        "As chaves do painel são as MESMAS que o FADEC",
        "aciona; no FADEC elas mudam sozinhas.",
        "MAIN · EXT PWR · BOMBA COMB. · STARTER",
        "IGNIÇÃO · COMBUSTÍVEL · GERADOR · GOV",
        "START / STOP · TESTE · manete · marcha",
    ), fill=FILL4, size=6.8)
    s.legend(960, 770)


# =====================================================================================================
# FOLHA 3 — lógica, anunciadores, limites e defeitos
# =====================================================================================================
def table(s: Sheet, x, y, cols, rows, widths, title=None, size=6.6, head_fill=INK, zebra=colors.HexColor("#f1f4f6")):
    c = s.c
    if title: s.text(x, y + 8, title, 9, "SansB")
    rh = size * 2.05
    yy = y - rh
    c.setFillColor(head_fill); c.rect(x, yy, sum(widths), rh, stroke=0, fill=1)
    xx = x
    for w, h in zip(widths, cols):
        s.text(xx + 4, yy + rh * 0.32, h, size, "SansB", colors.white); xx += w
    for i, r in enumerate(rows):
        yy -= rh
        if i % 2 == 0: c.setFillColor(zebra); c.rect(x, yy, sum(widths), rh, stroke=0, fill=1)
        xx = x
        for w, cell in zip(widths, r):
            s.text(xx + 4, yy + rh * 0.32, cell, size, "Sans", INK); xx += w
    c.setStrokeColor(SOFT); c.setLineWidth(0.5); c.rect(x, yy, sum(widths), y - yy, stroke=1, fill=0)
    return yy


def sheet3(s: Sheet):
    s.frame(3, 3, "LÓGICA, ANUNCIADORES, LIMITES E DEFEITOS",
            "Condições exatamente como na simulação (turbinePanel.ts, turbine.ts, engineSystems.ts).",
            "Lógica, luzes e limites")
    x1, x2 = M + 4, 610
    y = table(s, x1, H - 92, ["LUZ", "COR", "ACENDE QUANDO"], [
        ("BAT", "âmbar", "bateria no barramento E descarregando (corrente < −0,5 A real)"),
        ("STARTER", "âmbar", "starter ligado (chave + energia)"),
        ("IGNIÇÃO", "âmbar", "ignição ligada (chave + energia)"),
        ("GERADOR", "âmbar", "barramento energizado E gerador fora do barramento"),
        ("GOV", "âmbar / verde", "âmbar = chave GOV desligada (manual) · verde piscando = governador atuando"),
        ("EXT PWR", "verde / âmbar / verm.", "verde = GPU no barramento · âmbar = disponível fora · vermelho = FALHA"),
        ("ÓLEO QUENTE", "vermelho", "óleo > 110 °C (+ alarme sonoro)"),
        ("EGT ALTA", "vermelho", "EGT > 720 °C"),
        ("CHAMA", "vermelho", "fogo visível saindo do escape"),
        ("N2 SOBREV.", "vermelho pisc.", "N2 > 106 % (a turbina livre se desgasta)"),
        ("TESTE", "todas", "botão TESTE segurado + barramento com tensão: todas acesas + alarme"),
    ], [92, 92, 380], "ANUNCIADORES (cockpit escuro: apagado = normal)")

    y = table(s, x1, y - 40, ["FONTE", "CONDIÇÃO PARA ENTRAR NO BARRAMENTO"], [
        ("Baterias (K1)", "MAIN ligada E seletor em BOTH"),
        ("GPU (K3)", "cabo conectado E GPU ONLINE (4,5 s) E EXT PWR fechado E MAIN E seletor ≠ OFF"),
        ("Gerador (K2)", "chave GERADOR E starter desligado E barramento ligado E turbina girando"),
        ("Nenhuma", "MAIN desligada OU seletor em OFF → barramento sem tensão (0 V)"),
    ], [120, 444], "FONTES DO BARRAMENTO")

    y = table(s, x1, y - 40, ["SITUAÇÃO", "O QUE ACONTECE"], [
        ("Barramento sem tensão > 0,3 s", "solenoide de combustível fecha → a turbina apaga (spool-down)"),
        ("Seletor em BUS sem GPU nem gerador", "apaga em ~0,4 s (não há fonte)"),
        ("Seletor em BUS com o gerador", "segue funcionando só pelo gerador (baterias fora)"),
        ("EXT PWR em ON sem a GPU, barco energizado", "FALHA EXT PWR: luz vermelha + alarme"),
        ("EXT PWR sem MAIN", "a chave muda de posição, sem efeito"),
        ("Partida pelo FADEC com a GPU", "EXT PWR fecha com a GPU estável e abre na marcha lenta"),
        ("Saída da vaga do píer", "o cabo da GPU solta sozinho; o diesel roda 4 s e para"),
    ], [190, 374], "COMPORTAMENTOS DO BARRAMENTO")

    # coluna direita
    y = table(s, x2, H - 92, ["GRANDEZA", "VALOR"], [
        ("Potência", "~1100 shp · N2 100 % = 6000 rpm · redução 2,4:1"),
        ("Marcha lenta", "N1 62 % · EGT ~480 °C · 85 L/h"),
        ("Máximo", "N1 101 % · EGT máx. 640 °C · até ~470 L/h"),
        ("Partida", "~21 s · acende a 12 % N1 · starter sai a 45 %"),
        ("EGT", "alerta 720 °C · linha vermelha 700 · partida quente > 780"),
        ("Óleo", "alarme 110 °C · dano > 120 °C · 0–100 psi"),
        ("N2", "governador ~103,5 % · aviso / desgaste > 106 %"),
        ("Tensões", "~19 V no arranque (60 %) · ~28 V com gerador/GPU"),
        ("Starter", "~175 A · limite 40 s contínuos → trava 60 s"),
        ("Gerador", "28 V · até 60 A"),
        ("GPU", "28 V · 2,5 mΩ · partida 4,5 s · parada 4 s"),
        ("Combustível", "900 L (querosene/diesel) · começa com 120 L (temp.)"),
    ], [110, 440], "VALORES DE REFERÊNCIA")

    y = table(s, x2, y - 40, ["ERRO NO MANUAL", "DEFEITO (como numa turbina real)"], [
        ("Combustível antes de 12 % N1", "partida QUENTE: pouco ar, a EGT dispara"),
        ("Combustível sem ignição", "acumula na câmara → partida MOLHADA (labareda)"),
        ("Starter solto antes de 45 %", "ROLLBACK: o N1 cai e não sustenta"),
        ("Starter ligado demais / > 60 %", "superaquece: térmico desarma, trava 60 s"),
        ("EGT ou óleo acima do limite", "desgaste acumulado → turbina TRAVA (oficina)"),
        ("GOV desligado em N a pleno", "N2 dispara > 106 % → desgaste até quebrar"),
    ], [180, 370], "DEFEITOS DA PARTIDA MANUAL (sem proteção)")

    s.box(x2, M + 80, 550, 120, "NOTAS", (
        "• Esquema FUNCIONAL da simulação da POC (AQUA RUSH), não projeto de instalação real:",
        "  disjuntores, fusível ANL, shunts e massa estão representados para clareza; a simulação",
        "  não modela bitolas de fio nem a corrente nominal dos disjuntores.",
        "• A simulação calcula em 'equivalente 12 V' (150 Ah, starter 350 A, gerador 120 A, molinete 70 A);",
        "  os valores deste diagrama são os reais de 24 V (tensão × 2, corrente ÷ 2), como mostra o HUD.",
        "• Fonte da verdade: o código em pocs/babylon/src/sim e docs/SISTEMAS_ELETRICOS_E_MOTORES.md.",
        "• Regerar: python docs/diagramas/gerar_ar10_eletrico.py",
    ), fill=FILL, size=6.8)


def main():
    c = canvas.Canvas(OUT, pagesize=landscape(A3))
    c.setTitle("AQUA RUSH — AR-10 — Diagrama elétrico 24 V")
    c.setAuthor("AQUA RUSH"); c.setSubject("Esquema elétrico e de controle da lancha de turbina AR-10 (POC Babylon)")
    s = Sheet(c)
    for f in (sheet1, sheet2, sheet3):
        f(s); c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    main()
