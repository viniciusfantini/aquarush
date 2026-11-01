# AQUA RUSH

Jogo 3D de navegação aquática em mundo aberto para **mobile e navegador**. O núcleo do jogo é a sensação de pilotagem e a interação com a água.

O documento de premissas (GDD + arquitetura + plano de POC) está em [`docs/AQUA_RUSH_GDD_COMPLETO_v2.docx`](docs/AQUA_RUSH_GDD_COMPLETO_v2.docx). Há uma versão em texto puro, útil para busca, em [`docs/GDD_texto_extraido.txt`](docs/GDD_texto_extraido.txt).

## Estratégia

O GDD (seção 10) pede a **mesma fatia jogável** em três tecnologias antes de escolher a engine definitiva. As POCs vão da mais simples para a mais complexa:

| # | Tecnologia | Pasta | Status |
|---|---|---|---|
| 1 | **Babylon.js + TypeScript** (browser-first, sem instalar engine) | [`pocs/babylon`](pocs/babylon) | ✅ **v0.3.0 jogável**: física testada (48/49 critérios), água vidro, esteira na água, cavitação |
| 2 | Unity 6 LTS + URP | [`pocs/unity`](pocs/unity) | ⏳ planejada (Unity não instalado nesta máquina) |
| 3 | Unreal Engine 5 | [`pocs/unreal`](pocs/unreal) | ⏳ planejada |

A comparação entre as POCs, com os pesos da matriz do GDD §11, é registrada em [`docs/POC_COMPARATIVO.md`](docs/POC_COMPARATIVO.md).

## Rodar a POC 1 (Babylon.js)

Requisitos: Node.js 22.18+ (testado com 24.16).

```bash
cd pocs/babylon
npm install
npm run dev          # http://localhost:5173  (também acessível na rede local, para testar no celular)
npm run test:sim     # roteiro físico do GDD A.12 (testes 1–6) sem navegador
npm run typecheck
npm run build        # gera dist/ (site estático)
```

Parâmetros de URL: `?q=low|med|high` (qualidade), `?webgpu=1`, `?touch=1` (força os controles touch).

### Controles

| Ação | Teclado | Gamepad | Touch |
|---|---|---|---|
| **Manete F / N / R** | toque **S/↓**: F → **N** (sem empuxo, para) → **R** (ré lenta). Toque **W/↑**: R → **N** → **F** (frente lenta) | LT / RT ou D-pad ↓ / ↑ | alavanca à direita: faixa branca = N, logo acima = F lenta, logo abaixo = R lenta |
| Acelerar na marcha engatada | **segure** W (em F) ou S (em R); ao soltar volta à lenta, ainda engatado | segure RT / LT (analógico) | arraste a alavanca para longe do N |
| Direção | A D / ← → | analógico esquerdo | joystick à esquerda |
| Trim + / − | E / Q | RB / LB | TRIM+ / TRIM− |
| Câmera externa ↔ cockpit | C | Y | CAM |
| Luzes de navegação | L | X | LUZ |
| Reposicionar no píer | R | Back | ↺ |
| Água: vidro / calma / lago / forte | 0 (ou G) / 1 / 2 / 3 · V alterna | | toque no chip “ÁGUA” |
| Telemetria · pausa · ajuda | F3 · P · H | Start (pausa) | |

## Estrutura do repositório

```
README.md            este arquivo
CLAUDE.md            guia para agentes de IA (convenções, decisões, como validar)
docs/                GDD original + comparativo das POCs
pocs/babylon/        POC 1 — Babylon.js (TypeScript + Vite)
pocs/unity/          POC 2 — planejada
pocs/unreal/         POC 3 — planejada
```

## Registro de evolução

| Data | Versão | O que mudou |
|---|---|---|
| 2026-10-31 | babylon 0.1.0 | POC 1: lago com margens, ilha, rio com correnteza, rochas, vegetação, píer e marina. Lancha com corpo rígido 6DOF, flutuação em 6 pontos, planeio emergente, trim físico, colisões. Água Gerstner compartilhada entre física e shader. Esteira, spray, câmeras externa e cockpit, HUD, teclado, gamepad e touch, áudio procedural. Testes físicos headless. |
| 2026-10-31 | babylon 0.2.0 | Água **vidro (glass)** e presets de água. **Reflexo planar real** (lancha, margens e píer refletidos). **Esteira integrada à água**: um mapa de esteira deforma a superfície (braços do V de Kelvin, cristas e cavados), perturba os reflexos e gera espuma da hélice, do casco e da fervura. **Cavitação e ventilação da hélice** na física (perda de empuxo, RPM sobe), com fervura branca, bolhas, névoa, spray, aviso no HUD e som. **Lancha refeita**: casco com strakes e flare, cockpit rebaixado, para-brisa envolvente, guarda-mancebo, bancos estofados, plataformas e escada de banho, painel com velocímetro e conta-giros de ponteiro, motor de popa com capô, placa anticavitação, pé e skeg, **hélice de 3 pás com passo, torção e skew** e disco de borrão. Materiais PBR com ambiente. |
| 2026-10-31 | babylon 0.3.0 | **Manete F/N/R**: um toque para trás põe em N (sem empuxo, a lancha desliza e para); o segundo engata a ré em lenta (anda devagar para trás); segurar acelera. O mesmo para frente. A troca passa por N com 0,45 s de embreagem. Lenta engrenada empurra de verdade (~5 km/h para frente, ~3 km/h em ré). |
| 2026-10-31 | babylon 0.2.1 | Correção: a esteira saía para frente (eixo Z da textura invertido no upload). A hélice passou a girar proporcional ao RPM do motor. |

Os detalhes técnicos, as medições e as limitações conhecidas estão em [`pocs/babylon/README.md`](pocs/babylon/README.md).
