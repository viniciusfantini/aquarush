# AQUA RUSH

Jogo 3D de navegação aquática em mundo aberto para **mobile e navegador**.

**▶ Jogar online (POC Babylon):** https://viniciusfantini.github.io/aquarush/ — funciona no navegador do computador e do celular (controles touch automáticos). O núcleo do jogo é a sensação de pilotagem e a interação com a água.

O documento de premissas (GDD + arquitetura + plano de POC) está em [`docs/AQUA_RUSH_GDD_COMPLETO_v2.docx`](docs/AQUA_RUSH_GDD_COMPLETO_v2.docx). Há uma versão em texto puro, útil para busca, em [`docs/GDD_texto_extraido.txt`](docs/GDD_texto_extraido.txt).

## Estratégia

O GDD (seção 10) pede a **mesma fatia jogável** em três tecnologias antes de escolher a engine definitiva. As POCs vão da mais simples para a mais complexa:

| # | Tecnologia | Pasta | Status |
|---|---|---|---|
| 1 | **Babylon.js + TypeScript** (browser-first, sem instalar engine) | [`pocs/babylon`](pocs/babylon) | ✅ **v0.17.0** (online: a última publicada): lancha 150 hp ou **bote de apoio 15 hp** (escolhidos no menu com prévia no lago), física testada (183/184 critérios), rampa de concreto com carretinha e veículo para tirar o barco da água, barco que vira e pessoas boiando de colete e nadando até ele, água vidro, esteira na água, cavitação |
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

Parâmetros de URL: `?barco=lancha|bote` (pula a tela de escolha), `?q=low|med|high` (qualidade), `?webgpu=1`, `?touch=1` (força os controles touch).

Na abertura, o **menu já fica no lago**: a embarcação escolhida boia no píer e a câmera gira em volta dela (prévia real, com a mesma física). Escolha **Lancha AR-6** (6 m, 150 hp, volante, manete, power trim, partida na chave, luzes de navegação; tanque de 120 L, começa com 3 L) ou **Bote de apoio AR-3** (3,1 m, 15 hp, até 3 pessoas, cana do leme no motor, partida na corda, trim manual, lanterna de mão; tanque portátil de 10 L, começa com 1 L) e toque **PILOTAR**. O chip **TROCAR BARCO** volta ao menu sem recarregar.

### Controles

| Ação | Teclado | Gamepad | Touch |
|---|---|---|---|
| **Manete F / N / R** | toque **S/↓**: F → **N** (sem empuxo, para) → **R** (ré lenta). Toque **W/↑**: R → **N** → **F** (frente lenta) | LT / RT ou D-pad ↓ / ↑ | alavanca à direita: faixa branca = N, logo acima = F lenta, logo abaixo = R lenta |
| Acelerar na marcha engatada | **segure** W (em F) ou S (em R); ao soltar volta à lenta, ainda engatado | segure RT / LT (analógico) | arraste a alavanca para longe do N |
| Direção | A D / ← → | analógico esquerdo | joystick à esquerda |
| Trim + / − (lancha: power trim, segure) | E / Q | RB / LB | TRIM+ / TRIM− |
| **Bote: trim manual** (sempre que não estiver acelerando) | toque **E/Q**: pino 1 · 2 · 3; **E** no pino 3 levanta o motor todo (tilt); **Q** abaixa | RB / LB | TRIM+ / TRIM− |
| **Recolher o motor (tilt)** | segure **E** no fim do trim, em **baixa rotação** (pode estar engatado e andando devagar); **Q** baixa | segure RB | segure TRIM+ |
| Câmera externa ↔ cockpit | C | Y | CAM |
| Luzes de navegação (lancha) · lanterna de mão do piloto (bote) | L | X | LUZ |
| Reposicionar no píer (lancha 3 L, bote 1 L; desvira o barco e todos voltam a bordo) | R | Back | ↺ |
| Ocupantes (peso e posição) | O | | chip OCUPANTES |
| Água: vidro / calma / lago / forte | 0 (ou G) / 1 / 2 / 3 · V alterna | | toque no chip “ÁGUA” |
| **Ligar/desligar o motor** (partida só em N; no bote, cada P é uma puxada na corda) | P | B | ⏻ |
| **Ir para a rampa** (treinar subir o barco na carretinha) | T | | |
| **Dirigir o carro/caminhonete** (automático depois que a cinta prende o barco na carretinha) | W frente · S freio e, parado, ré · A/D direção | RT / LT + analógico | alavanca acima do N = frente, abaixo = freio/ré; joystick |
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
| 2026-11-01 | babylon 0.17.0 | **Dirigir o veículo de reboque**: com o barco no berço e a cinta presa, depois de ~1,5 s o comando passa para o carro (bote) ou a caminhonete (lancha). Comando simples: frente, freio, ré, direita, esquerda. O barco fica preso na carretinha, o motor dele desliga e as pessoas vão para o veículo. Modelo do veículo: bicicleta com tração, freio, ré até 9 km/h, peso na rampa e freio automático parado. A carretinha articula no engate e segue o veículo; de ré ela dobra até encostar no para-choque (80°, aviso CANIVETE). O chip mostra veículo, velocidade e ângulo da carretinha. R volta ao píer e T à rampa (com a carretinha estacionada de novo). |
| 2026-11-01 | babylon 0.16.0 | **Rampa de concreto** (12 %, 5,5 m de largura, ranhuras antiderrapantes e meio-fio) 22 m a oeste do píer, entrando no lago, já no relevo da física. **Carretinha** estacionada de ré na rampa, do tamanho de cada barco (lancha: 7 m, engatada numa **caminhonete**; bote: 3,6 m, engatada num **carro comum**), com bunks acarpetados, roletes de quilha, guincho, postes-guia, rodas e para-lamas. Física da manobra: berço em V que só apoia por cima (o casco desliza e se centraliza), postes-guia e batente de proa. Chegando de proa, devagar e alinhado, o barco sobe; o chip CARRETINHA guia (desvio lateral, ângulo, distância até o guincho) e, encostado, mostra **NA CARRETINHA ✓** e prende a **cinta do guincho** (com o motor desligado o barco não escorrega). **T** leva o barco para a frente da rampa para treinar. Contatos agora com rigidez proporcional à massa (o bote ficava instável). |
| 2026-11-01 | babylon 0.15.0 | **Depois de cair**: cada pessoa se recupera ~1 s e **nada** (até 0,7 m/s, com braçadas alternadas) até um lugar em volta do barco, do lado em que caiu (nunca por baixo do casco), e fica ali de frente para ele, ao alcance do cabo de mão, acompanhando a deriva. **Sem ninguém no comando**, acelerador, direção, trim e partida não fazem nada (aviso "Ninguém no comando"). **Bote**: o pino/tilt manual pode ser mudado **sempre que não estiver acelerando** (parado ou deslizando na lenta); acelerando aparece "Solte o acelerador". |
| 2026-11-01 | babylon 0.14.0 | **Barco virado**: deitado além de ~75° por 0,4 s, o corta-circuito desliga o motor e os ocupantes caem para o lado em que o barco deitou; o peso deles sai do barco. Na água cada pessoa **boia de colete** (centro do colete na linha d'água, postura reclinada, braços remando), sobe e desce com as ondas, é levada pela correnteza, não atravessa o casco e não se sobrepõe aos outros. R desvira e põe todos a bordo. **Menu no lago** com prévia da embarcação (câmera girando; o barco boia com a física real) e troca de barco sem recarregar. **Bote**: sem luzes de navegação; **L** acende uma lanterna de mão (o piloto ergue a mão direita com a lanterna e um foco de luz aponta para a frente); tanque de **10 L**, começa com **1 L**. |
| 2026-11-01 | babylon 0.13.0 | **Bote de apoio AR-3** (escolha na abertura): RIB de 3,1 m, 118 kg seco, motor de popa 15 hp bicilíndrico com **cana do leme** (o motor inteiro gira; manopla do acelerador e alavanca de câmbio no motor, animadas), até 3 pessoas (banco de popa e banco do meio), tanque portátil de 12 L, **partida na corda** (sem bateria; motor frio pode pedir 2–3 puxadas), **trim manual** em 3 furos (−4°, 0°, +4°) + tilt total de 70°, tudo **só com o bote parado** e com movimento progressivo (~0,8 s por furo, ~1,5 s para levantar). Dinâmica: ~44 km/h só com o piloto (0→30 em 3,4 s), ~33 km/h lotado, curva fechada com a cana sem emborcar; consumo 0,6–5,5 L/h. Som de bicilíndrico (escape mais curto) e som da corda. HUD do bote sem temperatura e bateria (o motor de cana não tem esses instrumentos). |
| 2026-11-01 | babylon 0.12.0 | **Bateria que descarrega de verdade**: cada partida (170 A) e a bomba do trim/tilt gastam carga; a resistência interna sobe com a descarga, então a tensão despenca na partida e o arranque gira mais devagar. Com 65 % ainda pega; com ~40 % gira fraco e costuma não pegar; com 10 % só estala o solenoide. Navegando, o alternador recarrega (~5 %/min). A carga/descarga roda **10× acelerada** (bateria de 50 Ah) para o efeito aparecer numa sessão. **Apito de autoteste** ("piiii", ~1 s) ao ligar a chave, antes do arranque girar. Começa com **3 L** no tanque; aviso de combustível baixo pisca no HUD com os litros restantes, acende o LED no painel e aparece um aviso ao ligar. O relógio da bateria mostra o % de carga. |
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
