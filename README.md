# AQUA RUSH

Jogo 3D de navegação aquática em mundo aberto para **mobile e navegador**.

**▶ Jogar online (POC Babylon):** https://viniciusfantini.github.io/aquarush/ — funciona no navegador do computador e do celular (controles touch automáticos). O núcleo do jogo é a sensação de pilotagem e a interação com a água.

O documento de premissas (GDD + arquitetura + plano de POC) está em [`docs/AQUA_RUSH_GDD_COMPLETO_v2.docx`](docs/AQUA_RUSH_GDD_COMPLETO_v2.docx). Há uma versão em texto puro, útil para busca, em [`docs/GDD_texto_extraido.txt`](docs/GDD_texto_extraido.txt).

## Estratégia

O GDD (seção 10) pede a **mesma fatia jogável** em três tecnologias antes de escolher a engine definitiva. As POCs vão da mais simples para a mais complexa:

| # | Tecnologia | Pasta | Status |
|---|---|---|---|
| 1 | **Babylon.js + TypeScript** (browser-first, sem instalar engine) | [`pocs/babylon`](pocs/babylon) | ✅ **v0.11.0 online**: física testada (100/101 critérios), água vidro, esteira na água, cavitação |
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
npm run deploy       # typecheck + testes + build e publica no GitHub Pages (branch gh-pages)
```

Parâmetros de URL: `?q=low|med|high` (qualidade), `?webgpu=1`, `?touch=1` (força os controles touch).

### Controles

| Ação | Teclado | Gamepad | Touch |
|---|---|---|---|
| **Manete F / N / R** | toque **S/↓**: F → **N** (sem empuxo, para) → **R** (ré lenta). Toque **W/↑**: R → **N** → **F** (frente lenta) | LT / RT ou D-pad ↓ / ↑ | alavanca à direita: faixa branca = N, logo acima = F lenta, logo abaixo = R lenta |
| Acelerar na marcha engatada | **segure** W (em F) ou S (em R); ao soltar volta à lenta, ainda engatado | segure RT / LT (analógico) | arraste a alavanca para longe do N |
| Direção | A D / ← → | analógico esquerdo | joystick à esquerda |
| Trim + / − | E / Q | RB / LB | TRIM+ / TRIM− |
| **Recolher o motor (tilt)** | segure **E** no fim do trim, em **baixa rotação** (pode estar engatado e andando devagar); **Q** baixa | segure RB | segure TRIM+ |
| Câmera externa ↔ cockpit | C | Y | CAM |
| Luzes de navegação | L | X | LUZ |
| Reposicionar no píer (volta a 30 L) | R | Back | ↺ |
| Ocupantes (peso e posição) | O | | chip OCUPANTES |
| Água: vidro / calma / lago / forte | 0 (ou G) / 1 / 2 / 3 · V alterna | | toque no chip “ÁGUA” |
| **Ligar/desligar o motor** (partida só em N) | P | B | ⏻ |
| Telemetria · pausa · ajuda | F3 · Esc · H | Start (pausa) | |

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
| 2026-11-01 | babylon 0.11.0 | **iPhone nítido**: a resolução segue a densidade real da tela (até 2× em `med`, 1,5× em `low`, 2,5× em `high`). Antes o celular renderizava a 1/1,5 do pixel CSS (no iPhone, 1/4,5 da resolução nativa). iPhone/iPad começam em `med` (reflexo, espuma, sombras). **Resolução dinâmica**: cai 10 % por vez se o FPS ficar abaixo de 40 e volta acima de 57 (F3 mostra a resolução). **Motor recolhido**: a direção agora gira o motor no próprio eixo (que inclina com o tilt), como no suporte real; antes ele girava em torno da vertical do barco e varria o pé para os lados. A física usa a mesma ordem (tilt por fora, direção por dentro). |
| 2026-10-31 | babylon 0.10.2 | **Power trim elétrico**: a bomba puxa ~30 A (trim), ~40 A (tilt) e ~45 A no batente; a tensão cai (~0,4 V com o motor desligado; com o motor ligado o alternador não dá conta); trim mais lento com a bateria fraca; zumbido da bomba no som. Tilt bloqueado acima de ~15 km/h mesmo em N (água no pé). |
| 2026-10-31 | babylon 0.10.1 | Acelerador e trim voltam a ser **barras** ao lado dos relógios. **Publicado online** no GitHub Pages (`npm run deploy`). |
| 2026-10-31 | babylon 0.10.0 | **Peso real na física**: massa seca de 1030 kg + gasolina (0,74 kg/L, no tanque sob o piso) + ocupantes (80 kg, cada um no seu banco); cada peso age na sua posição (afunda, embica, aderna) e a inércia é recalculada. **O** alterna a lotação (só piloto, carona, 2 na popa, lotada) com os passageiros visíveis. Começa com **30 L** no tanque. **HUD novo**: relógios redondos com ponteiro e leitura digital dentro (velocidade, RPM com horímetro, combustível com **consumo L/h** e autonomia, temperatura, bateria, trim), sem sobreposição. |
| 2026-10-31 | babylon 0.9.0 | **Instrumentos do motor** simulados: combustível (tanque de 120 L, consumo real; acabou, o motor morre), temperatura (termostato ~58 °C; sem água de refrigeração superaquece → proteção a 2000 rpm → desliga), bateria (12,6 V parado, 14,2 V carregando, cai na partida) e horímetro (salvo no navegador). **Painel real**: velocímetro e conta-giros com horímetro LCD, relógios de combustível, temperatura, voltímetro e trim, luzes de alarme, chave de ignição e interruptores. **Volante e manete funcionais**: volante com ¾ de volta para cada lado; manete lateral F/N/R que se move com a marcha e o acelerador, com botão de trim. **Piloto refeito** com braços por IK (mão esquerda no volante, direita na manete). HUD com quadro de instrumentos e alarmes. |
| 2026-10-31 | babylon 0.8.1 | Tilt como no motor real: funciona **engatado e andando em baixa rotação** (água rasa); quem bloqueia é o **empuxo da hélice** (> 1800 N) ou a rotação/velocidade alta, não a marcha. |
| 2026-10-31 | babylon 0.8.0 | **Física da hélice dentro/fora d'água**: empuxo ∝ fração do disco submersa^1,5, perda extra por ar puxado (ventilação); no ar, sem carga, o motor dispara até o **limitador de giro** (6100 rpm, com corte audível); solta em N no ar, demora a parar. **Splash coerente**: recolhido = sem spray/fervura, só **gotas escorrendo** do pé; **aflorando** = as pás picam a superfície e jogam um leque de água (máximo com meio disco submerso). |
| 2026-10-31 | babylon 0.7.0 | Adesivo do motor = potência real da física (**150**), ligado a `params.ts`. **Trim × tilt** como no motor real: na faixa de trim (−6°..+10°) a hélice continua na água; segurando trim+ no fim do curso, **recolhe até 60°** (hélice e entrada d'água saem da água, sem empuxo e sem esguicho). Bloqueado em velocidade/rotação alta. |
| 2026-10-31 | babylon 0.6.0 | **Lenta com cara de 4 tempos**: pulsos longos e graves em baixa rotação, menos irregularidade, escape de lenta grave, válvulas mais presentes (brilho da lenta caiu de 480 Hz para 298 Hz). **Bolhas de escape na lenta** (fervura fina na superfície e bolhas subindo da hélice). **Curva corrigida**: ao soltar o volante a lancha não volta mais para o lado oposto (sustentação lateral do casco e amortecimento de guinada). **Hélice gira solta em N** (arrastada pela água, para junto com a lancha). Sempre começa com **água 1 — calma**. |
| 2026-10-31 | babylon 0.5.0 | **Som do motor por síntese física** (AudioWorklet): cada explosão de cada cilindro vira um pulso com variação de ciclo a ciclo, que passa por tubos de escape ressonantes e sai abafado e borbulhando pelo cubo da hélice; soma o escape de lenta, o tique das válvulas, a admissão e o motor de arranque. **P liga/desliga o motor**: partida só em N, com motor de arranque e o motor "pegando"; pausa foi para Esc. **Esteira persistente e física**: dura ~90 s, as ondas se abrem e alargam, e a lancha **sente a marola** ao cruzá-la (o mesmo histórico alimenta a física e o shader). |
| 2026-10-31 | babylon 0.4.1 | Esguicho de refrigeração mais fraco: em lenta é só um fio que cai rente ao capô; ganha força com o RPM. |
| 2026-10-31 | babylon 0.4.0 | **Som de motor de popa 4 tempos, 4 cilindros (~60 hp)**, sintetizado a partir do RPM e da carga reais: bloco liso, escape borbulhando pelo cubo da hélice, tique de válvulas, zumbido da rabeta, admissão, "clunk" ao trocar de marcha e chiado de cavitação. Adesivo **"60"** no painel traseiro do capô (sem marca). **Esguicho da água de refrigeração** (tell-tale): jato contínuo cuja vazão sobe com o RPM. |
| 2026-10-31 | babylon 0.3.0 | **Manete F/N/R**: um toque para trás põe em N (sem empuxo, a lancha desliza e para); o segundo engata a ré em lenta (anda devagar para trás); segurar acelera. O mesmo para frente. A troca passa por N com 0,45 s de embreagem. Lenta engrenada empurra de verdade (~5 km/h para frente, ~3 km/h em ré). |
| 2026-10-31 | babylon 0.2.1 | Correção: a esteira saía para frente (eixo Z da textura invertido no upload). A hélice passou a girar proporcional ao RPM do motor. |

Os detalhes técnicos, as medições e as limitações conhecidas estão em [`pocs/babylon/README.md`](pocs/babylon/README.md).
