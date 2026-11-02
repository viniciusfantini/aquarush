# POC 1: Babylon.js (browser-first)

É a implementação **mais simples possível**, sem perder a física necessária. Roda direto no navegador, com TypeScript, Vite e Babylon.js e sem instalar nenhuma engine. A física é **própria e independente da engine**. A Babylon só desenha.

- Babylon.js `9.33.1` (`@babylonjs/core`, `@babylonjs/materials`)
- TypeScript `7.0.2`, Vite `8.3.5`, Node `24.16` (os testes usam o type stripping nativo do Node)
- Renderização WebGL2 (padrão) ou WebGPU (`?webgpu=1`)

## Arquitetura (GDD §9)

```
src/
  core/config.ts            perfis de qualidade low/med/high, passo de física (120 Hz)
  sim/                      SIMULATION: sem dependência de Babylon (roda no Node)
    math.ts                 vetores/quaternions (X direita, Y cima, Z proa)
    water.ts                IWaterSurface + GerstnerWater (altura, normal, correnteza, profundidade)
    world.ts                relevo do lago (função), ilha, rio, rampa, estrada, pátios, píer (colisores), correnteza
    params.ts               PARÂMETROS DOCUMENTADOS das 4 embarcações: SPEEDBOAT (AR-6), DINGHY (AR-3), RAPIDA (AR-9), TURBINA (AR-10) — contrato entre as 3 POCs
    hullShape.ts            forma do casco da lancha (seções) — fonte única do visual e da hidrostática do porão
    engineSystems.ts        combustível, arrefecimento, bateria/alternador/amperímetro, jump start, horímetro (12 ou 24 V: `nominalV`)
    turbine.ts              turbina a gás de eixo livre: N1, N2, EGT, torque, óleo, governador, sequência de partida, falhas
    boat.ts                 corpo rígido 6DOF (forças e torques), controles, N motores (EngineUnit: pistão ou turbina), hélice comum ou de superfície,
                            bancos de bateria, porão/bomba, alagar/afundar, emborcamento (habitáculo fechado), avarias
    anchor.ts               âncora de proa: cabo, unhar, garrar, molinete
    bilgeJet.ts             jato da bomba de porão como linha de emissão (referencial do barco)
    wind.ts                 vento em 5 níveis com rajadas
    wake.ts                 histórico da esteira (física + visual)
    mooring.ts              vaga do píer, poitas (BuoyField), boias do canal, largada atracada
    trailer.ts              carretinha (berço, postes, batente, cinta do guincho)
    towVehicle.ts           carro/caminhonete + carretinha articulada (TowRig)
    station.ts              posto, loja, oficina, vagas, frota de exposição (obstáculos)
  gameplay/vehicleInput.ts  contrato VehicleInput (GDD 9.2): marcha, acelerador, direção, trim, âncora, neutro, bomba, comando por motor (engineCmd)
  platform/input.ts         adaptadores teclado / gamepad / touch → VehicleInput (Z/X = empuxo diferencial)
  presentation/             WATER RENDERING + INTERACTION + UI
    waterMaterial.ts        shader GLSL: MESMAS ondas da física + esteira + reflexo planar + vidro + carneirinhos
    wakeMap.ts              mapa de esteira top-down (V de Kelvin, espuma da hélice, fervura de cavitação)
    waterInteraction.ts     orquestra o mapa de esteira + partículas (spray, rooster tail, bolhas, névoa — um conjunto por hélice)
    exhaustFx.ts            fumaça e fogo do escape da turbina (pela fase, chama, EGT e potência)
    waterJet.ts             jato de água de uma saída do casco (água de resfriamento da turbina pelo espelho)
    gpuCart.ts              GPU da doca (gerador a diesel de 28 V; lâmpada pelo estado) e o cabo até a tomada da AR-10
    turbinePanel.ts         painel de partida da turbina (Y): FADEC ou manual com as chaves + sistemas
    systemsPanel.ts         painel de sistemas (Y) dos barcos a pistão: baterias, registro, afogador, bomba de porão, luzes
    dragPanel.ts            janelas arrastáveis pela barra de título (posição salva)
    switches.ts             chaves de painel em CSS: alavanca, 3 posições, rotativo, chave de ignição, puxador, corda
    levers.ts               manetes do painel Y (topo, dupla, cana, potência + marcha) e o trim (power trim ou pino)
    environment.ts          terreno, árvores, píer, marina, restaurante, piscina
    boatMesh.ts / dinghyMesh.ts / rapidaMesh.ts / turbineMesh.ts   as 4 embarcações procedurais (PBR): motores, rabetas,
                            transmissão de superfície, hélices, canopy e escape da turbina
    boatGear.ts             âncora + cabo, jato da bomba de porão (gotas, espuma)
    helm.ts / pilot.ts      posto do piloto (painel, volante, manete, chave) e pessoas com IK (sentadas, em pé, na água)
    ramp.ts                 rampa, carretinhas, carro e caminhonete
    station.ts / restaurant.ts / fleet.ts / mooring.ts   estrada, posto, restaurante, frota de exposição, boias e cabos
    cameras.ts              externa (mola + órbita) e cockpit
    hud.ts                  HUD que lê só a telemetria real (relógios por barco: um ou dois motores, painel de turbina; âncora, porão, vento)
    audio.ts + engineWorklet.js  motor de popa, V8 (2 vozes), turbina, água, buzina, alarme, molinete, vento (Web Audio, procedurais)
  main.ts                   bootstrap, splash → escolha do barco → jogo, laço com física em passo fixo e render interpolado
index.html                  HUD, splash (imagem + JOGAR + idioma), menu de escolha do barco, painel de partida
public/splash.svg           ilustração da tela de abertura
tests/
  sim.test.ts               roteiro GDD A.12 + sistemas (headless, PASS/FAIL)
  debug-*.ts                diagnósticos: curva, trim, carretinha (`debug-trailer.ts lancha|bote|rapida|turbina`), rampa, âncora, porão,
                            alagar, vento, AR-9 (`debug-rapida.ts`), AR-10 (`debug-turbina.ts [trim]`), etc.
```

## Modelo físico (resumo)

A lancha é um **corpo rígido 6DOF** (massa seca de 1030 kg + gasolina, ocupantes e água do porão como cargas na posição; tensor de inércia diagonal com Steiner), integrado por Euler semi-implícito a **120 Hz em passo fixo**. Não há `Translate`: tudo são forças e torques. Os parâmetros ficam em `src/sim/params.ts`.

| Força | Como |
|---|---|
| Flutuação | 6 pontos (proa, centro e popa, bombordo e boreste). Empuxo = ρ·g·A·profundidade, mais amortecimento vertical |
| Arrasto | por ponto, nos eixos do casco: longitudinal (atrito ∝ área molhada) e lateral forte (quilha) |
| Planeio | sustentação ∝ ½ρu²·A·CL·ângulo de ataque local (incidência do fundo + atitude), na normal do fundo (gera arrasto induzido). **O planeio surge sozinho**: o casco sobe, a área molhada cai e o arrasto também |
| "Hump" | sistema de ondas do próprio casco (onda na proa, cavado na popa, em Froude ~0,5): a proa empina antes de planar. Mais resistência de ondas |
| Propulsão | empuxo na posição da hélice; cai com a velocidade (passo da hélice); direção = esterço + trim; ventila perto da superfície |
| Tilt (recolher) | segurando trim+ no fim do curso, a rabeta gira até +60° em torno do pivô no espelho. Funciona **engatado e andando em baixa rotação** (modo água rasa). O que bloqueia é a **carga no pé**: empuxo > 1800 N, rotação > 2200 rpm ou mais de 29 km/h. A velocidade de recolhimento cai com o empuxo. A posição da hélice e da entrada d'água giram junto: a hélice sai da água (sem empuxo) e o esguicho para. Em velocidade/rotação alta o tilt é bloqueado, como no power trim real |
| Trim | inclina o vetor de empuxo e age como flap da rabeta (força ∝ u² na popa). **Muda a atitude e a velocidade de fato** |
| Manete F / N / R | a marcha pedida vem de `VehicleInput.gear`. Toda troca passa por N com 0,45 s (embreagem da rabeta) e só engrena com o acelerador em lenta. Em N o empuxo é zero. Engrenado em lenta, o motor dá 4 % do empuxo (≈ 5 km/h para frente e ≈ 3 km/h em ré) |
| Massa e carga (v0.10) | massa **seca** de 1030 kg (casco + motor) no CG de referência, mais **gasolina** (0,74 kg/L, tanque em (0; −0,22; −0,9)) e **ocupantes** de 80 kg nos bancos (piloto em boreste, carona em bombordo, 2 no banco de popa). Cada peso é aplicado **na sua posição** (gera torque → trim e banda); a massa total e o tensor de inércia (Steiner) são recalculados a cada passo. Aproximação: o acoplamento translação–rotação do CG deslocado é desprezado (deslocamentos de poucos cm) |
| Elétrica (v0.32–v0.39) | **Bateria** de 50 Ah, tensão de repouso de chumbo-ácido: 12,7 V cheia, ~12,2 V a 50 %, ~11,9 V a 15 %, **~10,2 V zerada**. **Alternador** de 35 A (~9 A já em lenta, máximo perto de 3000 rpm), limitado pelo que a bateria aceita; regulador 13,6–14,2 V. **Amperímetro** no painel (+ carga, − consumo: partida −170 A, trim −30 A, molinete −27 a −120 A, bomba −4 A). Trim, tilt e molinete precisam de ≥ 9 V sob carga (senão só o relé estala); partida precisa de ≥ 10,5 V. **Jump start**: 10 Ah, até 200 A (acima disso a proteção desarma), conecta a qualquer momento, alimenta tudo enquanto ligado, desconecta sozinho quando o motor pega e recarrega a ~10 A em cruzeiro. Buzina e luzes seguem a tensão |
| Sistemas do motor (v0.9) | **Combustível**: tanque de 120 L, consumo pela carga (3 L/h em lenta a ~55 L/h a toda); perto do fim o motor engasga e depois morre; sem combustível não pega. **Temperatura**: termostato ~58–64 °C (aquece em ~1–2 min); sem água na entrada do pé sobe ~2 °C/s → alarme a 85 °C, **proteção a 90 °C** (limita a 2000 rpm e 30 % de acelerador), **desliga a 115 °C**; desligado esfria devagar e só pega abaixo de 90 °C. **Bateria** de 50 Ah (v0.12; tensões e alternador atualizados na linha "Elétrica" acima). Resistência interna de 9 mΩ (cheia) a ~39 mΩ (vazia): na partida (170 A) a tensão cai ~2 V com ela cheia e ~4 V a 40 %. Rotação do arranque = 260 rpm × (V − 7,5)/3,1; o motor pega depois de 3 a 5 voltas "úteis" (rotação de compressão > 60 rpm) e a tentativa desiste após 4 s ("não pegou"). Com a bateria zerada (< 10,5 V) nem o relé arma. Carga e descarga com **aceleração de jogo de 10×** (`batteryTimeScale`), documentada em `engineSystems.ts`. Autoteste de 1,1 s com apito antes do arranque. **Horímetro** soma o tempo ligado (salvo no navegador) |
| Cavitação | índice = f(carga × escorregamento da hélice). Com carga alta e pouca velocidade (arrancada), perde até 30 % do empuxo e o RPM sobe. Some em cruzeiro |
| Hélice × superfície (v0.8) | **imersão** = fração do disco (R = 0,19 m) dentro d'água; empuxo × imersão^1,5. **Aeração**: com o disco raso a hélice puxa ar e perde até 50 % a mais. **No ar**: sem carga, o motor sobe até o **limitador** (6100 rpm), que corta a ignição em pulsos (som de "bap-bap"). Em N a hélice gira solta: freada pela água quando imersa, quase sem freio no ar |
| Agarre lateral do casco | sustentação lateral da quilha/strakes ∝ u·v_lateral, aplicada perto do CG (sem efeito cata-vento), mais amortecimento de guinada. A lancha derrapa ~7° numa curva forte e, ao soltar o volante, a guinada morre em ~0,7 s **sem voltar para o lado oposto** (antes voltava ~16°) |
| Inclinação em curva | torque ∝ aceleração centrípeta (casco em V) + amortecimento de rolagem |
| Colisões | penalidade mola-amortecedor com atrito em 12 pontos de contato contra o fundo (função de altura), as rochas (esferas) e o píer (caixas). Desde a v0.45 o contato com o fundo/margem usa a **normal real do terreno** (gradiente do relevo) e o atrito no plano da encosta: parede íngreme barra o barco (não vira rampa) e numa encosta acima de ~24° (atrito 0,45) a gravidade o faz escorregar |
| Correnteza e ondas | a velocidade relativa à água usa a correnteza; as alturas vêm das mesmas ondas de Gerstner do shader |
| Vento (v0.36–v0.37) | 5 níveis (0 / ~6 / ~14 / ~23 / ~39 nós) com rajadas e direção oscilando. Vento aparente: longitudinal no CG (`airDragCdA`), lateral no centro vélico (`windage`) — deriva ~3 % do vento, banda e proa a sotavento. Não levanta ondas (lago); só carneirinhos no shader |
| Âncora (v0.34) | cabo pago/recolhido pelo molinete; ao tocar o fundo vira mola só de tração; poder de garra ∝ filame (cabo ÷ profundidade, ~5:1 = máximo de 4000 N na lancha); acima disso garra (ara o fundo); recolhendo puxa o barco e desunha |
| Porão, bomba, alagar e afundar (v0.34–v0.41) | entrada por **orifício** no furo (Cd·A·√(2g·Δh), A ∝ avaria^1,3, Δh = fora − nível de dentro, nos dois sentidos) e **vertedouro** na borda/espelho (1,8·L·h^1,5, respingos, menos andando, poço do motor segura 2/3). Nível: sob o piso pela forma do casco (15 % livre, ~480 L: o resto é espuma, tanque e longarinas), acima pelo cockpit (7 m²); o peso da água sobe e vai para o meio. **Superfície livre** (v0.42): a água solta corre para o lado mais baixo (I/V·tg θ, com 0,8 s de atraso; sob o piso 25 %) — popa baixa puxa mais água para trás e o barco pode virar. **Visual** (v0.42.1): a água solta sobre o piso é desenhada com o volume da simulação, superfície horizontal no mundo (`boatGear.ts`, grade sobre o cockpit, nível por busca binária do volume). **Drenos do cockpit** no piso da popa (2 × 1,5", sem válvula): com a popa abaixo da linha d'água a água entra por eles. **Bomba** 1500 GPH (v0.46.1; antes 750): Q = Qmáx·(1 − H/2,7 m)·f(tensão) ≈ 1,15 L/s, a vazão que ela tinha antes da curva; jato v = Q/A pela mangueira de 1 1/8". **Borda livre** < 3 cm = alagado/inavegável (~2.900 L na lancha, água calma); peso > empuxo máximo do casco (8,5 t) = afunda (~3.850 L). Com ondas é bem antes: com 1.500 L e ondas fortes a lancha vira: motor desliga, pessoas na água. Bote inflável não afunda |
| Ré e espelho (v0.43) | de ré o espelho (placa reta) vai na frente: arrasto ½·ρ·Cd·A·u² na área molhada dele (Cd 1) → ré a toda ~9 km/h; a água empilha contra ele (0,6·u²/2g) e soma à marola. O espelho é verificado em 6 trechos (rebaixo do motor no meio, convés de popa até os cantos): vertedouro + efeito de pá (Q = 0,8·largura·lâmina·v de ré) |
| Barco virado (v0.46) | o casco virado enche de água, menos a **bolsa de ar** presa sob o convés/console (35 % do volume alagável na lancha). O ar escapa pelo furo do casco e pelas frestas a v ≈ √(2·ρágua·g·h/ρar) ≈ 60 m/s; sem ar e com o peso acima do empuxo do casco, **afunda**. Afundado, as pessoas nadam até o ponto onde ele afundou e ficam **juntas em roda**. Bote inflável: os flutuadores seguram |
| Avarias | casco: pico de contato > 4× o peso; motor: pé raspando o fundo andando, baixar o motor contra o chão, batidas na carretinha/carro. Casco avariado arrasta mais e abre o furo do porão |

**Água compartilhada:** `GerstnerWater.shaderParams()` envia ao shader exatamente as ondas que a física consulta. `getHeight` inverte o deslocamento horizontal de Gerstner por iteração de ponto fixo. No teste, o desvio médio entre o casco e a superfície é de 3 cm.

> Referência completa da lógica elétrica e dos motores: [`docs/SISTEMAS_ELETRICOS_E_MOTORES.md`](../../docs/SISTEMAS_ELETRICOS_E_MOTORES.md).

## AR-10: chave GOV e sobrevelocidade do N2 (v0.64)

**v0.64.4:** relógios do Y com 82 px; luz **GOV** única (âmbar = chave desligada, apagada = ligada, verde piscando = governador atuando); luz **CHAMA** = fogo saindo do escape (`TurbineExhaustFx.fireRate`, o mesmo cálculo das partículas; acende na labareda do acendimento).

**v0.64.3:** luz **GEN** = gerador fora do barramento ("cockpit escuro"): acesa antes da partida e se ele cair; apaga quando ele entra (conferido: acesa parada e na partida, apagada em marcha lenta, acesa ao desligar a chave GEN, apagada ao religar).

**v0.64.2:** luz **BAT** = bateria alimentando o barramento (descarregando): parada −9,7 A acesa, partida −164 A acesa, gerador no barramento +15,3 A apagada.

**v0.64.1:** a proteção automática de sobrevelocidade saiu (pedido do usuário): com o GOV desligado, acima de 106 % de N2 o desgaste sobe ∝ excesso (`(N2 − 106)/100` por segundo) até a turbina travar — no teste, N2 a 125 %, 9 % de desgaste em 3 s e quebrou em 7,6 s. Com o GOV ligado, a toda com ondas, nenhum desgaste. Luz **GOV** (verde) no lugar da CHAMA: acende enquanto o governador limita o combustível (`Turbine.govActing`). Os displays de avisos não criam rolagem no painel (`contain: paint`; painéis com `overflow-x: hidden`).


- **O que limitava a aceleração em N:** o governador da turbina livre. Em neutro a hélice quase não tem carga; pouco gás leva o N2 a 100 % e o governador corta o combustível a ~101–104 % — o N1 fica em ~71 % (EGT ~500 °C) mesmo com a manete toda.
- **Chave GOV** (`Turbine.governor`, chave 8 da botoeira): ligada (padrão; no FADEC sempre governa) = como acima. Desligada (manual) = a manete comanda o combustível direto: em N o N1 sobe (80 % no teste), mas a turbina livre sem carga dispara: aviso **N2 SOBREV.** acima de 106 % e a **proteção independente de sobrevelocidade** (não desliga) corta o combustível a 113 % e soma 5 % de desgaste. Anunciador **GOV OFF** (âmbar).
- **Governador revisto:** proporcional + antecipação pela aceleração do N2 (perto do limite) + **corte rápido de combustível** acima de ~104 % (a potência cai com o combustível antes de o N1 desacelerar). Motivo: com ondas, a hélice de superfície ventila e o N2 saltava até 113 % a toda — antes isso ficava escondido por um teto de 110 % no N2, que foi tirado (agora vai a 125 %).
- Testes: GOV ligado em N a pleno → N2 102,8 %, N1 71 %; GOV desligado em N → N1 80 %, corte a 113 % em 2,3 s, turbina apagada e desgaste; a toda com ondas e GOV ligado → N2 máx. 105,5 % sem cortar; óleo a toda 90 °C. No navegador: GOV OFF âmbar, N1 76 %, corte e "AVARIA MOTOR 5%".

## Abandonar o barco — barra de espaço (v0.63)

**v0.63.5:** nado de colete até ~0,55 m/s (antes 0,35): voltam a bordo em 4,9 s de perto; pulando a 65 km/h, em 173 s.

**v0.63.2:** longe do casco a pessoa não acompanha mais o barco (só quem segura o cabo de mão, a < 0,6 m do lugar); volta a bordo com o barco a até 3 km/h. Pulando a 65 km/h, 6 s depois ela nada a 0,35 m/s; o barco desliza ~80 m e para, e a volta leva 274 s.

**v0.63.1:** dois toques — o 1º espaço tira só os passageiros (o piloto fica no comando e o motor segue ligado); o 2º (ou sem passageiros) tira o piloto, e o corta-circuito desliga o motor. Nado de colete até ~0,35 m/s (antes 0,7): no teste, voltam a bordo em 6,7 s.

`Speedboat.abandonShip()`: os ocupantes pulam na água de colete, cada um pelo bordo do seu banco, com impulso para fora e para cima (`Swimmer.jumped`). O cordão do **corta-circuito** está no piloto: com ele fora o motor desliga (`stall = "lanyard"`). Na água eles nadam até o seu lugar em volta do casco (o mesmo nado do emborcamento) e **voltam a bordo** sozinhos (`updateSwimmers` → `occupants`, contador `reboarded`) quando chegam a ~0,45 m do lugar, depois de 2,5 s na água, com o barco **de pé, não afundado e a até 3 km/h** (v0.63.2). Na **AR-10 virada** o piloto fica preso no cinto do habitáculo fechado; o espaço o tira da cabine e ele fica na água, a salvo — com o barco virado ninguém volta a bordo (R recomeça). Testes ("abandonar"): 2 pessoas pulam, motor desligado pelo corta-circuito, afastamento de 3,3 m, todos a bordo de novo em 4,2 s; AR-10 virada: o piloto sai e fica na água. No navegador: o piloto da AR-6 pula, nada e volta ("Todos de volta a bordo").

## Painel da AR-10 (v0.62.3 → v0.62.7)

**v0.62.7:** START em cima (legenda AUTO-START) e STOP embaixo.

**v0.62.6:** alinhado — botoeira das 7 chaves numa faixa; START/STOP numa seção própria ao lado de baterias / tanque / bomba; manetes alinhadas pela base; o aviso de "sem pressão" do câmbio hidráulico vai para o display de avisos.

**v0.62.5:** 700 px de largura, em faixas: mostradores / anunciadores (4 colunas) / botoeira de partida (7 chaves + START/STOP, com mais folga entre o START, o texto FADEC e o STOP) / sistemas / manetes / avisos.


**v0.62.4:** 840 × 555 px em faixas independentes (flex): [mostradores | anunciadores em 2 colunas] / [botoeira de partida: 7 chaves + START/STOP] / [sistemas | manetes] / [avisos]. A **GPU da doca não fica no Y** (comando externo): cabo pelo J, na barra de atalhos à esquerda do HUD, e o estado no visor do carrinho.

v0.62.3, em grade (`.tp-grid`): no alto os 8 mostradores e, ao lado, os anunciadores em 2 colunas; no meio a botoeira de partida (as 7 chaves + START/STOP) e, embaixo dela, sistemas (baterias, tanque, bomba de porão) com a **GPU da doca** (botão do cabo + estado); à direita, numa coluna, as manetes (potência e marcha, buzina e trim); no pé, o display de avisos. 960 × 555 px (antes 690 × 694) — não cobre o HUD. Em tela estreita (< 900 px) a grade vira uma coluna só.

## Painéis estreitos (v0.62.1 → revisto na v0.62.2)

**v0.62.2:** a largura mínima ficou ruim; agora a AR-10 tem 690 px (mostradores e anunciadores numa linha, as 7 chaves + START/STOP numa botoeira só) e o painel de sistemas até 640 px (PARTIDA e COMANDO lado a lado quando cabem), com mais folga entre a barra do trim e o botão e em volta da buzina.

v0.62.1: os painéis do Y ocupavam a menor largura possível: AR-10 com 492 px (antes 830) — mostradores em 2 linhas de 4, anunciadores em 2 linhas, faixa de chaves em 2 linhas ao lado de START/STOP, sistemas e manetes empilhados; sistemas dos barcos a pistão com ~470 px (antes até 760) — PARTIDA, COMANDO e SISTEMAS empilhados, cada um na largura do painel. O botão redondo vermelho da AR-10 diz **STOP** (sem legenda embaixo); o verde, START, com "FADEC" embaixo.

## Painel da AR-10 sempre completo, checklist, buzina/apito (v0.62)

- **Painel de partida sempre completo** (`turbinePanel.ts`): as 7 chaves (MAIN … GERADOR) ficam sempre à vista, ao lado de dois **botões redondos** (no estilo do STOP do bote): **START** = partida automática (FADEC; = P) e **CORTE** (no FADEC corta/aborta; no manual fecha o combustível e solta starter e ignição). O seletor FADEC/MANUAL saiu: um **indicador** no título mostra quem comanda — **mexer em qualquer chave (menos a MAIN) passa para o MANUAL** (o FADEC deixa de proteger), e START (ou P) devolve ao FADEC. Voltar ao FADEC não liga mais a MAIN (`Turbine.setFadec`).
- **CHECKLIST**: o botão no título abre uma janela à parte (`ChecklistPanel`, arrastável) com a partida automática e a manual; cada item é marcado ✓ pela telemetria real e o próximo fica em destaque.
- **Buzina** no painel Y de todas as embarcações (segurar, `InputManager.panelHorn`, o mesmo do B) e **apito** de bolinha no bote (`audio.setHorn("apito")`: ~3,1 kHz com o trinado ~27 Hz + sopro; não depende de bateria). A ajuda mostra "B apito" no bote.
- **Trim só com a barra** (faixa de trim verde, tilt âmbar) + botão UP/DN; o bote segue com o pino.
- **Compacto**: chaves e mostradores menores, dicas das manetes viraram tooltip, sem títulos de seção no painel da turbina (563 px de altura, antes ~720).

## Avisos no display do painel e trim no Y (v0.61)

- **Avisos de sistemas/motor no display do painel**: `sysToast` (main.ts) manda os avisos de chaves, partida, marcha, combustível, porão, trim/tilt, GPU, jump start, eventos da turbina, avarias e falhas para o display do pé do painel do Y quando ele está aberto (`SystemsPanel.flash` / `TurbinePanel.flash`, ~6 s; depois volta o aviso de estado). Com o painel fechado continuam no aviso do HUD. Avisos que não são de sistemas (amarras, carro, vento, lotação, pausa, barco virado/afundado) seguem no HUD.
- **Trim no painel Y** (`LeverControls.setTrim` / `updateTrim`, junto das manetes), pelo tipo de embarcação:
  - **AR-6** (popa): **TRIM / TILT** — botão basculante UP/DN momentâneo (= E/Q) e barra (a vista de lado do motor saiu na v0.62) com a faixa de trim (verde, −6° a +10°) e a de tilt (âmbar, até +60°); mostra "TILT BLOQUEADO" e "SEM FORÇA (relé)".
  - **AR-9** (rabetas): **TRIM DAS RABETAS** — o mesmo botão, as duas rabetas juntas (o trim é comum aos dois pés).
  - **AR-10**: **TRIM DA TRANSMISSÃO** — imersão da hélice de superfície (−5° a +8°, tilt curto de 12°).
  - **Bote**: sem trim elétrico — o **PINO DO TRIM** no suporte do motor (furos 1–3 e T = tilt travado), com ▲▼ para mudar o pino (só com o acelerador solto, como antes no E/Q).
- O botão de trim é mais um dispositivo de entrada (`InputManager.touchTrim`), como as manetes.
- No navegador: AR-6 — aviso do registro no display (HUD sem aviso), UP segurado 1,5 s → +7,4°, 6 s → tilt 55° (pé fora d'água, marcador na faixa âmbar); bote — pino 2 → 3 e o aviso "Motor no pino 3 de 3" no display; AR-10 — DN → −2,0° e o aviso do modo manual no display de vidro.

## AR-10: EXT PWR sem MAIN e falha do EXT PWR (v0.60.3)

- No manual a chave **EXT PWR** é só do piloto: muda de posição sempre (`EngineSystems.extPwr` não é mais zerada quando o cabo sai, exceto no FADEC). O efeito depende do cabo, da GPU estável e da MAIN (`extOnline`).
- Anunciador **EXT PWR**: verde = GPU no barramento; **âmbar piscando** = GPU disponível/partindo mas fora do barramento (relé aberto **ou sem MAIN** — a luz é alimentada pela própria GPU); **vermelho piscando** = falha.
- **Falha do EXT PWR** (`telemetry.extPwrFault`): manual, chave em ON, **sem a GPU conectada** e o barco energizado (MAIN + fonte) → EXT PWR vermelho, alarme de cautela (o mesmo "master caution" do óleo) e aviso na tela. Some ao desligar a chave ou conectar a GPU.
- Testes: sem MAIN com a GPU estável a chave fica em ON e o barramento em 0 V; sem GPU e energizado → falha; chave desligada → a falha some. No navegador: âmbar piscando sem MAIN, vermelho piscando com o alarme sem GPU.

## AR-10: chave MAIN (v0.60.2)

A antiga chave BAT da AR-10 chama-se **MAIN**: ela liga o barramento dos **sistemas eletrônicos** (`Turbine.master` → `EngineSystems.busOn`), não a bateria — quem coloca as baterias no barramento é o seletor **OFF / BUS / BOTH**. A **espia** da MAIN acende quando ela está em ON **e** o barramento tem tensão de qualquer fonte: baterias (BOTH), GPU (BUS ou BOTH, EXT PWR fechado) ou o gerador da turbina. Em BUS sem GPU nem gerador ela fica em ON com a espia apagada. O anunciador **BAT** continua mostrando as baterias no barramento. No navegador: BOTH → espia acesa (24,4 V); BUS sem GPU → ON e apagada; BUS + GPU → acesa (27,9 V); MAIN desligada → 0 V.

## Acelerar em neutro no painel, câmbio hidráulico, lanterna e displays (v0.60)

- **Acelerar em neutro pelas manetes** (`LeverCmd.neutral` → `VehicleInput.neutralThrottle`, a mesma função do N + W): na manete de topo da AR-6/AR-9, o botão **N** no meio do quadrante só arma com a manete em N; armado, empurrar a manete só acelera (a marcha fica em N; sem limite em N desde a v0.60.4) e ele desarma quando a manete volta para N. Na AR-9 cada manete tem o seu botão. No bote, o punho girado com o câmbio em N acelera em neutro (era o defeito relatado: o punho em N não fazia nada); na AR-10, a potência em N também.
- **Câmbio hidráulico da AR-10** (`params.hydraulicShift`): as embreagens da caixa reversora dependem da pressão de óleo da bomba acionada pelo motor — com a turbina parada a alavanca mexe, mas a marcha **não engata**; se a turbina para engatada, volta para N. O painel avisa "SEM PRESSÃO". Os barcos a pistão (câmbio mecânico) seguem engatando parados.
- **Lanterna de mão** no bote (manual, a pilha) no lugar da chave de painel.
- **Display de avisos** (v0.60.1, `setRd` em `switches.ts`, classe `.msg-rd`): os avisos no pé dos painéis do Y ficam numa caixa de tamanho fixo (não deformam o painel); se o texto não couber, ele rola de um lado para o outro. Estilo por embarcação (`data-disp`): LCD verde com luz de fundo (AR-6), VFD âmbar (AR-9), LCD cinza refletivo (bote), vidro ciano de cockpit (AR-10). As leituras embaixo das chaves ficam no estilo simples.

## Seletor de baterias da AR-10, autoteste ao energizar e manetes (v0.59)

- **AR-10, seletor de baterias** (`batterySel` "off" | "bus" | "both", rotativo no painel de partida): as duas baterias de 12 V ficam **em série** (24 V) — por isso não há "1" e "2" como na AR-9 (uma sozinha daria 12 V). **OFF** isola o barramento; **BUS** tira as baterias e deixa o barramento só com a GPU (EXT PWR) ou o gerador (para partir só pela GPU, ou poupar baterias fracas); **BOTH** põe as duas em série no barramento. A chave **BAT** (`Turbine.master`) passa a ser o **mestre do barramento** (`EngineSystems.busOn`): desligada, nada chega a ele — nem a GPU, nem o gerador — e com a turbina rodando o solenoide de combustível fecha e ela apaga. FADEC: OFF ou BUS sem GPU → "sem energia".
- **Autoteste ao energizar** (pistão): com a chave de ignição já em ON e a chave geral em OFF nada apita; ao ligar a chave geral a central acorda e apita o autoteste (`EngineUnit.keyLive`).
- **Starter da AR-10 no manual**: é um starter-gerador (sem embreagem); quem tira o modo de partida é o controle de partida. No FADEC o "speed switch" corta (a 45 %, reserva a 60 %); no **manual ninguém corta** — é o piloto. Esquecido ligado acima de 60 % N1: aviso, aquece 4× mais rápido e o térmico desarma (trava ~60 s).
- **Manetes no painel Y** (`presentation/levers.ts`), uma por tipo de comando: **AR-6** manete única de topo (marcha + acelerador, R ← N → F com detentes); **AR-9** duas manetes independentes (punho vermelho BB, verde BE: empuxo diferencial na mão); **bote** punho giratório da cana (tartaruga ↔ lebre) + alavanca de câmbio F-N-R no motor; **AR-10** manete de potência em T num trilho (LENTA → MÁX) + alavanca de marcha separada. O painel é **mais um dispositivo de entrada**: manda {marcha, acelerador} por motor para o `InputManager` (`touchLever` com um motor, `panelLevers` → `engineCmd` com dois); teclado/gamepad retomam no próximo toque. Duplo clique volta a manete para N.

## Chaves de ignição, LEDs e chave geral (v0.58)

- **Chave de ignição por motor** (`Speedboat.setKey(i, "off" | "on" | "start")`, `EngineUnit.key`, telemetria `keys`): OFF desliga a ignição (o motor para); ON liga a ignição e faz o autoteste (apita ~1 s se houver tensão; sem tensão, nada); START gira o arranque **enquanto segurada** (`manualCrank`, sem o limite de 4 s do P) e volta para ON ao soltar (mola, `bindKeySpring`). Só em N. A AR-9 tem uma chave por motor (BB e BE). O P continua funcionando (liga as chaves em ON e faz a partida automática). No bote: **manete da corda** (= P) e **STOP**.
- **Chaves elétricas**: a posição é do piloto e não depende de energia; só o **LED** (a espia) acende quando a função está energizada (`setToggle(…, on, lit)`). Sem bateria, LUZES/BOMBA/BOMBA COMB./IGNIÇÃO ficam em ON com o LED apagado.
- **Registros de combustível** (tanque nos quatro barcos e a condição CORTE/LENTA da turbina) são seletores rotativos de punho amarelo, como a chave de baterias.
- **Correção (AR-9 em BE):** o P conferia `systems.canStart()` (o banco BB), que em BE fica isolado com 0 V no barramento → "bateria fraca". Agora cada motor confere o banco que o alimenta (`bankFor`).
- **Chave geral em OFF com o motor ligado:** os motores a pistão (AR-6, AR-9) **seguem ligados** pelo alternador, que segura a ignição; a bateria não carrega e o painel avisa do risco ao regulador. O bote (magneto) não depende de bateria. Na **AR-10** o gerador da turbina segura o barramento; sem gerador e sem GPU o **solenoide de corte de combustível** (normalmente fechado) perde a tensão em 0,3 s e a chama apaga.
- `telemetry.houseV`: tensão do barramento da casa (em BE é o banco de boreste); luzes, buzina e LEDs usam ela.

## Chaves de painel (v0.57)

Os painéis do Y usam chaves desenhadas em CSS (`presentation/switches.ts`, estilos em `index.html`), sobre uma placa com parafusos:

- **alavanca** (`toggle`): haste de inox com ponta esférica, porca sextavada, legendas gravadas em cima/embaixo e LED verde. Variantes: haste de ponta vermelha (combustível, condição da turbina) e **capa de proteção** vermelha que levanta (STARTER);
- **alavanca de 3 posições** (`tri`): bomba de porão ON / OFF / AUTO. O LED fica âmbar quando a bomba está armada e verde quando o motor dela está girando;
- **seletor rotativo** (`rotary`): chave geral de baterias com punho vermelho (OFF / ON; na AR-9 OFF / IND / BB / BE / AMBAS);
- **puxador** (`pull`): afogador do bote, que sai do painel e mostra a haste quando puxado.

**AR-10, baterias:** barcos a turbina desse porte usam um banco de 24 V (duas baterias de 12 V em série) com **chave geral** (BAT); alguns barcos de corrida têm uma segunda bateria só para os instrumentos e o FADEC. Aqui é um banco com a chave BAT. Ela fica no painel nos dois modos: no FADEC é do piloto (a automação não a liga), e sem BAT e sem GPU o P responde "sem energia no barramento". A âncora da AR-10 ganhou **molinete elétrico** (35 A reais a 24 V).

**Som da bomba de porão:** zumbido do motor DC sempre que a bomba gira (ON mesmo seca, ou AUTO com a boia), mais agudo seca e mais grave bombeando; o chiado da água do jato continua à parte.

## Painel de sistemas (v0.56, tecla Y)

Nos barcos a pistão o **Y** abre o painel de sistemas (`presentation/systemsPanel.ts`, arrastável; na AR-10 o Y continua abrindo o painel de partida da turbina, que ganhou a mesma linha de sistemas):

- **Chave de baterias** (`Speedboat.batterySel`): com um banco, OFF / LIGADA (desligada: sem partida, sem bomba de porão, sem luzes). Na **AR-9** (dois bancos): **IND.** (cada motor no seu banco, a casa no de bombordo — o normal), **BB** ou **BE** (um banco alimenta os dois motores e a casa; o outro fica isolado — a temperatura e o combustível de cada motor continuam separados, só a parte elétrica muda de rota), **AMBAS** (bancos em paralelo: a carga se iguala) e **OFF**. Com o banco BE zerado: IND. pega só bombordo; BB pega os dois; BE nenhum; AMBAS iguala a carga e pega os dois. O relógio de um banco isolado mostra a tensão da própria bateria.
- **Registro do tanque** (`EngineSystems.fuelValveOpen`, `lineL`): fechado, o motor ainda roda com o combustível que ficou na linha (0,08 L na AR-6, 0,04 L no bote, 0,2 L na AR-9, 0,3 L na AR-10), engasga no fim e morre; aberto de novo, a linha enche e ele pega.
- **Afogador** (bote carburado, `params.carbureted`, `Speedboat.choke`): com o motor frio a corda pega mal sem afogador (~7 % por puxada) e bem com ele (~85 %); com o motor quente e o afogador puxado a mistura fica rica — gira baixo e **afoga** em ~15 s. O bote sai do píer com o motor frio.
- **Bomba de porão** (`Speedboat.bilgeMode`): OFF (não bombeia nem com água), AUTO (a boia, como antes) e ON (manual, mesmo seca).
- **Luzes** de navegação (o mesmo do L).

## Tela de splash (v0.49–0.50)

A abertura (`#splash` em `index.html`, fluxo em `main.ts`: `showSplash` → `leaveSplash` → `showMenu`) é uma **imagem**: a ilustração vetorial `public/splash.svg` (pôr do sol num cânion: a AR-10 em primeiro plano com o rabo de galo da hélice de superfície e o escape de inox, a AR-9 rebocando um wakeboarder, parasail puxado pela AR-6, banana boat puxado pelo bote, boias de canal e a marca AQUA RUSH), cobrindo a tela. Na tela só há:

- o **idioma**: Português (Brasil) com a bandeira (selecionado, guardado em `localStorage` `aquarush.lang`) e English com a bandeira dos EUA e o selo **SOON** (não clica; ainda não há tradução);
- **JOGAR** → escolha do barco. Com `?barco=` na URL o jogo pula a splash e o menu.

## Lancha de turbina AR-10 (v0.48)

Quarta embarcação: **10 m, piloto único no centro, habitáculo fechado**, uma **turbina a gás de eixo livre** (~1100 shp) e uma transmissão de superfície com **hélice de superfície** (`TURBINA` em `params.ts`, modelo em `sim/turbine.ts`, visual em `presentation/turbineMesh.ts`).

- **Turbina** (`Turbine`, sem Babylon, testada no Node): gerador de gás (**N1** %) + turbina livre (**N2** %, eixo de saída 6000 rpm → hélice 2500 rpm pela redução 2,4). A manete comanda o N1 (marcha lenta 62 %, máximo 101 %) com aceleração limitada pela unidade de combustível (9 %/s). A turbina livre tem torque de "estol" ~2× o nominal com N2 baixo; a hélice absorve ∝ N2² × carga. O **governador** da turbina livre corta o combustível com N2 acima de ~101 % (sem carga, a toda: 103 %). EGT, torque, pressão de óleo e consumo (85 L/h em marcha lenta, ~430 L/h a toda) saem do mesmo modelo.
- **Partida (P, em N)**, como num turboeixo real: o **arranque** (starter-gerador, ~350 A) gira o gerador de gás; a **12 % N1** abrem a **ignição** (velas estalando) e o **combustível**; **acende** ~1 s depois (EGT sobe de uma vez, "vuum"); o gerador de gás acelera com o arranque ajudando e a EGT faz um pico (~660 °C com a bateria a 60 %); a **45 % N1** o arranque e a ignição desligam; **marcha lenta** a 62 % (~21 s no total). P de novo aborta a partida ou corta o combustível: a turbina desacelera (~18 s até 8 % N1) e só aceita nova partida abaixo de 8 % N1. **Falhas**: bateria a ~40 % → arranque lento, mais combustível que ar → **partida quente** (EGT passa de 780 °C, o combustível corta); bateria a ≤ 30 % → **partida pendurada** (o arranque não leva o N1 a 12 %); sem combustível → **não acende**. O jump start ajuda.
- **Hélice de superfície**: trabalha ventilada de propósito, com ~metade do disco fora d'água em planeio (imersão média 0,48 a toda). Menos imersão = menos carga e menos empuxo; mais imersão (parado, popa baixa) = mais carga e rendimento ruim em baixa velocidade. O **trim** da transmissão muda a imersão (trim −5° carrega mais a hélice). Força lateral da hélice ("prop walk") de 5 % do empuxo. Não conta como "ventilação" no alerta.
- **Habitáculo fechado**: virando, o piloto fica preso no cinto, dentro da célula de segurança (ninguém vai para a água) e a turbina apaga. Afundando, ele sai pela escotilha.
- **Hélice de superfície** (v0.55, `buildSurfaceProp` em `turbineMesh.ts`): 6 pás estilo **cleaver** (cutelo) de inox polido — bordo de ataque afiado e curvo, bordo de fuga **reto** (radial) e grosso (a seção é uma cunha), **cup** na borda de fuga, passo torcido pelo raio e caimento para trás — sobre um cubo longo e cônico com a porca; disco de borrão com a rotação.
- **GPU: desconexão em duas etapas** (v0.55, `gpuState` "stopping", `GPU_STOP_S` = 4 s): com o J o cabo sai na hora (a energia some); o diesel continua rodando sem carga por ~4 s ("STOPPING" na tela, lâmpada piscando, som a 1500 rpm) e só então desliga. Reconectando nesse intervalo, ela volta direto a ON.
- **Temperatura do óleo** (v0.54, `Turbine.oilC`, `oilWarnC` 110 °C, `oilRedC` 120 °C): o óleo esquenta com a rotação e a potência (mancais e engrenagens da caixa de redução) e é resfriado no trocador de calor pela água da bomba mecânica (vazão ∝ N1, só com a tomada submersa); a válvula termostática o segura em ~75 °C. Na água: ~79 °C em marcha lenta e ~91 °C a toda. **Fora d'água** (tomada fora da água, barco na carretinha) só o ar o resfria e ele sobe sem parar: a 110 °C o **alarme de óleo quente** (relógio ÓLEO °C vermelho, luz ÓLEO QUENTE no painel, etiqueta SUPERAQUECIMENTO e o alarme sonoro de dois tons) e acima de 120 °C os **mancais se desgastam** (`wear` → avaria do motor → a 95 % a turbina trava). **Não há corte automático** por temperatura (diferente do motor a pistão, que protege e desliga): quem resolve é o piloto (reduzir, cortar ou pôr a tomada na água).
- **Água de resfriamento** (v0.53, `params.cooling`, `telemetry.coolingLps`): a turbina marítima resfria o óleo de lubrificação (e o da caixa de redução) em **trocadores de calor com água do mar**. A bomba é **mecânica**, na caixa de acessórios do gerador de gás: a vazão acompanha o N1 (~0,5 L/s só com o starter girando, ~1,9 L/s em marcha lenta, ~2,9 L/s a toda) e só existe com a tomada d'água da transmissão submersa (fora d'água, na carretinha, não bombeia e o óleo esquenta). A água sai por uma saída de 1 1/4" no espelho, bombordo, acima da linha d'água, num **jato** desenhado como o da bomba de porão (`presentation/waterJet.ts`: linha de emissão no referencial do barco, gotas e espuma onde bate na água; `jetStreakLocal` ganhou a direção de saída). **Fumaça do escape** (v0.53): com o starter girando a seco não há combustão, então não sai fumaça; só uma névoa branca se houver combustível acumulado na câmara (partida molhada).
- **Periféricos, energia e EXT PWR** (v0.52): a bomba de combustível (~8 A), as velas (~3 A), o solenoide de combustível e o FADEC/instrumentos (`Turbine.peripheralA`) puxam corrente do barramento — com só a bateria nele, o amperímetro mostra ~−13 A. Sem tensão no barramento nada elétrico funciona: a chave da ignição fica em ON mas não há faísca (sem luz, sem o "tic-tic"), o starter não gira e os instrumentos ficam apagados ("sem energia", ponteiro no zero; `turbine.powered`). A GPU tem **dois comandos**: o **cabo** (J, físico) e o **relé EXT PWR** (`EngineSystems.extPwr`), que a põe no barramento — no FADEC (`autoExt`) ele fecha sozinho com a GPU estável e a turbina parada e abre na marcha lenta (o cabo continua, a GPU fica ON a 0 kW até o J); no manual é a chave EXT PWR do painel. O **amperímetro do HUD mede só a bateria** (shunt no cabo dela): com a GPU no barramento, a corrente do starter vem da GPU e aparece no relógio **GPU A** do painel (e em kW na tela do carrinho), e a bateria aparece carregando.
- **Barramento de 24 V com três fontes** (v0.51, `EngineSystems.batteryOn` / `genOn`): a **bateria** (relé da chave **BAT**), a **GPU** (**EXT PWR**, quando o diesel dela está estável) e o **gerador** da turbina (chave **GEN**; o starter-gerador só gera com o starter desligado). Starter, velas, bomba de combustível, luzes, trim e bomba de porão estão todos nesse barramento: com a BAT desligada eles só funcionam se a GPU ou o gerador estiverem alimentando, e a bateria sai do circuito (nem carrega nem descarrega). Com a BAT desligada e a turbina rodando, o gerador segura o barramento em ~27,8 V. No FADEC o GEN liga sozinho na marcha lenta; no manual, sem ligar o GEN a bateria não carrega.
- **Defeitos de sequência** (v0.51, como numa turbina real): **combustível cedo** (antes de ~12 % N1, pouco ar para ele) → partida quente; **combustível sem ignição** → partida molhada (acumula e acende com labareda); **starter solto antes de ~40 %** → rollback (desacelera e esquenta); **starter ligado mais de ~40 s seguidos** → superaquece, o térmico desarma e ele fica travado ~60 s; **starter acima de 50–60 % N1** → a embreagem não engata/desengata; **sem bomba de combustível** abaixo de ~45 % N1 → não chega combustível; **sobretemperatura** → desgaste (`wear`) que vira avaria do motor e, a 95 %, **trava a turbina** (o reparo da oficina, R, conserta).
- **Partida por chaves: FADEC ou MANUAL** (v0.50, `Turbine`): a física é dirigida pelas chaves do painel — **BATERIA** (sem ela o starter, as velas e a bomba não funcionam), **BOMBA** de combustível (pressão; acima de ~45 % N1 a bomba do motor basta), **STARTER**, **IGNIÇÃO** e **COMBUSTÍVEL** (válvula / manete de condição CORTE ↔ MARCHA LENTA). A câmara acende com combustível + ignição e N1 ≥ 9 %; combustível sem ignição (ou com N1 baixo) **acumula na câmara** e, quando acende, queima de uma vez (**partida molhada**: labareda e EGT ~970 °C); acesa, ela acelera com o starter e só se sustenta sozinha acima de ~40 % N1 — soltar o starter antes faz ela desacelerar e esquentar (**rollback**). O **FADEC** aciona essas chaves na ordem certa e protege (aborta partida pendurada, sem acendimento e quente). No **MANUAL** ninguém protege: passar de 780 °C **desgasta a turbina** (`wear`, perde potência). O **painel de partida** (tecla **Y**, `presentation/turbinePanel.ts`, no alto à direita e **arrastável** pela barra de título — a posição fica salva em `localStorage` `aquarush.tpanelPos`) mostra em **instrumentos analógicos** com as faixas verde/amarela/vermelha e a leitura digital dentro (v0.52, `RoundGauge.bands`) N1, EGT, N2, torque, óleo, barramento e a corrente da GPU, além do combustível na câmara, as luzes EXT PWR / STARTER / IGNIÇÃO / CHAMA / EGT ALTA, os botões do FADEC ou as cinco chaves com o procedimento. No manual o P não dá partida.
- **GPU da doca** (v0.49, no lugar do jump start; **gerador a diesel** desde a v0.50, `EngineSystems.gpuState`): ao conectar, o diesel parte (~0,9 s de starter), pega, passa do ponto e assenta em 1500 rpm (~4,5 s) — a lâmpada do carrinho, a luz GPU do HUD e a EXT PWR do painel **piscam** — e só então a energia é **chaveada** (luz fixa). Som próprio (`EngineAudio.updateGpu`: pulsos de combustão, batida de diesel, zunido do gerador e o starter, mais baixo longe da câmera). A GPU e um **assistente de colete amarelo** (que olha para a lancha e se vira para o painel do carrinho com a GPU ligando) só aparecem com a AR-10. **Diesel visível e audível** (v0.51, `GpuCart.updateDiesel`): chaminé com **fumaça escura** quando o diesel pega, clareando até parar com a rotação estável; quando a carga sobe de repente (ex.: o starter da turbina engata, ~5 kW), o governador abre o combustível — **baforada escura**, a rotação "afunda" um pouco e o som encorpa (`updateGpu` com a potência) até estabilizar. **Tela de status na traseira** do carrinho: STOP / STARTING / STABILIZING / ON, a potência fornecida (`-4.9 kW`), a rotação e 28 V. fonte de solo de **28 V DC** (`EngineSystems.gpu`; no modelo "equivalente 12 V" = 14 V com resistência de 2,5 mΩ e energia da rede). Segura o barramento na partida (arranque mais forte → turbina mais fria), alimenta as cargas e carrega a bateria. **Só conecta atracado na vaga do píer** (J); desconecta sozinha quando a turbina chega à marcha lenta (`gpuAutoOff`, como se faz com o cabo) ou ao soltar as amarras. O carrinho amarelo (`presentation/gpuCart.ts`) fica no píer à ré da vaga, com carretel, painel, placa "GPU 28 V DC · 600 A" e lâmpada verde ligada; conectada, um cabo desce do carrinho, corre pelo convés e cai em barriga até a **tomada externa** no costado da lancha (há uma em cada bordo).
- **Sistema elétrico de 24 V** (v0.48.2, como nas turbinas: duas baterias de 12 V em série + starter-gerador de 28 V): o modelo elétrico continua em "equivalente 12 V" (`EngineSystemsParams.nominalV`) e a telemetria mostra a tensão real (×2) e a corrente real (÷2). Arranque: ~19,4 V sob ~175 A; marcha lenta com o gerador: 27,8 V. O voltímetro vai de 16 a 32 V (vermelho abaixo de 23 V). Buzina, luzes e o voltímetro do painel 3D usam a tensão relativa.
- **Painel**: **N1 %** e **EGT °C** grandes; **TORQUE %**, **N2 %** (com a rotação da hélice), **ÓLEO psi** (com a temperatura do óleo), combustível, bateria e amperímetro pequenos; luzes **ARRANQUE / IGNIÇÃO / CHAMA / EGT** da sequência de partida. Todos leem `BoatTelemetry.turbine`.
- **Som** (síntese própria, `EngineAudio.updateTurbine`): zumbido do eixo e **apito do compressor** que sobem com o N1, passagem das pás (agudo), tom da turbina livre (N2), **rugido da combustão** e **jato do escape** com a potência, ar nas tomadas, **zunido do starter-gerador**, **estalos das velas** ("tic… tic…", alternando os lados) e o **"vuum" do acendimento**. Dentro do habitáculo tudo chega mais baixo e sem os agudos. Desligando, o apito desce com o N1 (spool-down).
- **Escape, fumaça e fogo** (v0.48.1, `presentation/exhaustFx.ts`, só lê a telemetria da turbina): **um duto de inox polido** (prata) sai da traseira da tampa pelo centro, corre para trás e faz uma curva suave: a boca aponta **45° para cima** e para trás (v0.48.2; antes, chaminé e depois dois dutos achatados). Na partida: sopro de ar no arranque; **névoa branca** de combustível na ignição antes de acender; no **acendimento**, uma **labareda** curta pelos bocais e um bolo de **fumaça escura** que vai clareando enquanto o gerador de gás acelera; na **partida quente** (EGT perto de 780 °C), **labaredas contínuas** e **fumaça preta** até o combustível cortar. Em operação, fumaça fina, mais densa ao acelerar; no corte, fiapos brancos que somem com o N1. A fumaça sai com o gás, herda a velocidade do barco e sobe (gás quente).
- **Visual**: casco em V profundo (fundo preto, costado grafite, faixa amarela), **canopy** (bolha de vidro com arcos e escotilha de emergência), tampa da turbina com duas tomadas de ar e os dois dutos de escape, abas de trim, transmissão de superfície com quilha-leme, cilindros hidráulicos e a hélice de superfície. Carretinha de 10 m na caminhonete.

## Lancha rápida AR-9: dois motores (v0.47)

Terceira embarcação: **8,6 m, 2 lugares, dois V8 de centro de 300 hp com rabeta** (`RAPIDA` em `params.ts`). Usa a **mesma física** dos outros barcos; o que muda são os parâmetros e a lista `engines` (posição lateral de cada rabeta).

- **N motores na física** (`EngineUnit` em `boat.ts`): cada motor tem marcha, acelerador, rpm, arranque, cavitação, ventilação, imersão e consumo próprios. O empuxo de cada um é aplicado **na posição da sua hélice** (±0,55 m do centro), então o **empuxo diferencial** surge sozinho: um em ré e o outro à frente giram o barco quase no lugar. Para isso, o amortecimento de guinada em baixa velocidade cai a 5 % (`yawDampingLowSpeed`); andando ele volta ao normal.
- **Comando**: a manete e o volante comandam os dois juntos (as rabetas giram juntas, como com a barra de ligação). `VehicleInput.engineCmd` (opcional) dá marcha e acelerador por motor: **Z** segurado = BB em ré e BE à frente (gira para bombordo); **X** = o contrário. Soltar volta os dois à manete.
- **Partida**: a chave liga os dois **um de cada vez** (o 2º espera o 1º terminar o arranque). O arranque de cada V8 puxa ~200 A.
- **Dois bancos, um por motor** (v0.47.1, `Speedboat.systems2`/`banks`): cada V8 tem bateria de 100 Ah, alternador, arrefecimento e horímetro próprios; o tanque é comum. O banco de bombordo também alimenta a casa (luzes, trim, molinete, bomba de porão) e recebe o jump start. Banco de boreste zerado: só o motor de bombordo pega. O HUD mostra **TEMP BB/BE** e **BAT. BB/BE** (cada relógio lê o seu motor/banco) e o amperímetro do banco de bombordo.
- **Efeitos de água por hélice** (v0.47.1): rooster tail, bolhas de escape, névoa de cavitação e leque das pás saem de **cada** hélice, com a rotação, o acelerador e a imersão daquele motor. Sem esguicho de refrigeração (motor de centro: a água sai com o escape).
- **Telemetria**: `rpms`, `gears`, `throttles`, `thrusts`, `engines`, `propRpms` por motor. O HUD mostra **um conta-giros por motor** (RPM BB / RPM BE, até 6.000, vermelho em 5.000) e o velocímetro até 140 km/h.
- **Som**: o worklet ganhou o **V8 de virabrequim cruzado** (8 explosões a cada 720°, pulsação desigual por bancada, escape mais longo). O 2º motor é uma segunda voz (outra semente aleatória, levemente à direita no estéreo), com o rpm e a carga dele.
- **Visual** (`presentation/rapidaMesh.ts`): casco em V profundo com pintura de corrida, praça de máquinas com tomadas de ar, para-brisa baixo, dois bancos concha, painel da AR-6 deslocado para a frente do piloto, **duas rabetas** com hélices contrarrotativas. Carretinha de 8,6 m puxada pela caminhonete; no pátio os dois conjuntos que não estão em uso ficam nas vagas 0 e 3.

## Terreno do rio/cânion (v0.45.1)

A malha geral do terreno (2,6 km, `terrainSubdiv` 160/256/360 → 16/10/7 m entre pontos) não acompanha as paredes do cânion. `environment.ts` desenha uma **faixa detalhada** ao longo do rio (`RIVER_STRIP`: ±66 m do eixo, 2 m entre pontos, alturas de `groundHeight`) e rebaixa a malha grossa embaixo dela (8 m até 40 m do eixo, 0,6 m até 66 m, para não cintilar). Medido: erro máximo 0,3 m, 0 % do rio desenhado como terra (antes 6,6 % em `med`, 14,8 % em `low`).

## Embaixo d'água (v0.44)

`main.ts` testa se a câmera está abaixo da superfície (mesma `getHeight` da física, com a esteira). Embaixo d'água: `scene.fog` verde-azulada (densidade 0,07 + 0,01/m de profundidade), sem céu, sobreposição `#underwater` (tom e vinheta), `waterVis.under` (o shader desenha a superfície vista por baixo: janela de Snell com cosseno > ~0,66, reflexão interna total fora dela) e `audio.setUnderwater` (passa-baixa no master). A câmera externa desce até −0,75 de inclinação de órbita e não entra no fundo (`cam.ground`).

## Água e interação (v0.2)

- **Presets de água:** vidro (glass: sem ondas nem ondulação fina), calma, lago e forte. A física usa a mesma amplitude que o visual.
- **Reflexo planar real** (`med`/`high`): a lancha, as margens, as rochas e o píer aparecem refletidos, com a distorção vinda das ondas e da esteira. Em `low` o reflexo é do céu analítico.
- **Esteira dentro da água** (`wakeMap.ts`): uma textura de 192 m × 192 m ao redor da lancha, redesenhada a cada quadro a partir do histórico da simulação:
  - braços do V de Kelvin (19,5° em deslocamento, mais fechado em planeio), com crista, cavado e crista secundária que deslocam a superfície e entortam os reflexos;
  - ondas transversais em baixa velocidade (λ = 2πv²/g);
  - água revolvida da hélice (espuma que se abre e some) e "bigode" de espuma no costado e na proa;
  - **fervura de cavitação e ventilação** na popa.
- **Hélice:** a velocidade visual é **proporcional ao RPM do motor** (escala fixa de 0,12: 750 rpm = 0,75 volta/s e 5300 rpm = 5,2 voltas/s, medido no navegador). A rotação real (até ~48 voltas/s) causaria efeito estroboscópico a 60 FPS. Disco de borrão suave acima de 1200 rpm da hélice; bolhas, névoa e spray extra quando cavita ou ventila; aviso piscante no HUD e chiado no áudio.
- A água não aparece dentro do cockpit (tampa só de profundidade).
- **Hélice e splash (v0.8):** a fervura, a névoa, o rooster tail e as bolhas só aparecem com a hélice dentro d'água. **Aflorando**, as pás picam a superfície e jogam um leque de água para cima e para trás, mais forte com metade do disco submerso e com a rotação. **Recolhida**, só escorrem gotas do pé, que somem em alguns segundos.
- **Bolhas de escape na lenta:** com o motor ligado e a lancha devagar, os gases saem pelo cubo da hélice: bolhas sobem em rajadas e a superfície atrás do pé "ferve" fino.
- **Esguicho de refrigeração (tell-tale):** bico no capô inferior (boreste) com jato de gotas: em lenta é um fio fraco que cai rente ao capô (0,35 m/s); a velocidade (até 1,6 m/s), a vazão e a espessura sobem com o RPM (bomba d'água). O jato herda a velocidade da lancha.

## Esteira na física (v0.5)

- `sim/wake.ts` guarda o histórico da esteira: uma amostra a cada 0,1 s, por até **90 s**.
- Cada braço do V tem crista, cavado e crista secundária. O braço se abre com a idade (ângulo de Kelvin), alarga por dispersão e perde amplitude devagar: e^(−t/45) / √(1 + t/6).
- A física usa `WaterWithWake`: altura da onda base + marolas com idade ≥ 3 s (a onda do próprio casco já está no modelo do hump).
- **Teste:** um retorno de 180° cruzando a própria esteira. Sem esteira, a aceleração vertical máxima é 0,11 m/s²; com esteira, **11,2 m/s²** (um tranco de ~1 g). Custo: **0,047 ms/passo**.
- **No navegador:** cruzando a 41 km/h, a marola sob o casco tinha 0,20 m, com velocidade vertical de 0,87 m/s.

## Áudio (v0.4 → v0.6): motor de popa 4 tempos, 4 cilindros em linha (150 hp, como os 150 hp 4T reais)

**v0.5: síntese física em AudioWorklet** (`presentation/engineWorklet.js`):

- **Explosões:** cada explosão de cada cilindro (ordem de queima a cada 180° do ciclo de 720°) gera um pulso de pressão, com pequenos erros de ponto, diferença entre cilindros e variação aleatória de ciclo a ciclo. É isso que tira o som "eletrônico".
- **Escape:** os pulsos passam por dois tubos ressonantes (guia de onda com reflexões).
- **Saída:** pelo cubo da hélice (bem abafada, com borbulhar debaixo d'água; mais seca com a hélice fora) e pelo escape de marcha lenta acima d'água ("putt-putt" que some com carga).
- **v0.6, lenta de 4 tempos:** em baixa rotação os pulsos ficam longos e redondos ("tum-tum"), com menos irregularidade entre ciclos; o escape de lenta é grave (~250 Hz) e as válvulas ficam mais audíveis. Brilho (centroide espectral) da lenta: 480 Hz na v0.5 → **298 Hz**; volume da lenta abaixo do cruzeiro.
- **Mecânica:** tique de válvulas e ar da admissão. Motor de arranque na partida; sem combustão, só as compressões.
- **Validação offline:** `node tests/engine-audio.check.mjs` renderiza lenta, cruzeiro, rotação máxima e partida. O pico espectral cai na frequência de queima: 26/116/186 Hz contra 25/117/187 Hz esperados, sem NaN. Os WAVs ficam em `tests/out/` para ouvir.
- **Limitação:** continua sendo síntese. O realismo máximo exigiria gravações reais (licenciadas) em vários RPMs, misturadas.

Camadas que continuam no grafo do Web Audio (e reserva, caso o AudioWorklet falhe):

Tudo sintetizado (Web Audio), a partir do RPM e da carga da simulação:

| Camada | Modelo |
|---|---|
| Bloco do motor | onda periódica no ciclo de 4 tempos (fundamental = RPM/120). Ordens de queima (RPM/30 Hz) dominam; 2ª ordem e meias-ordens fracas dão o "ronronar" liso de um 4T de 4 cilindros. Saturação suave e filtro que abre com a carga; ressonância do capô |
| Escape pelo cubo | ruído grave modulado pelos pulsos de queima (borbulhar abafado). Fica mais seco quando a hélice sai da água |
| Válvulas | "tique" agudo discreto, mais audível em lenta |
| Rabeta | zumbido fino (~13 × rotação), só engrenado e com carga |
| Admissão | chiado de ar com acelerador alto |
| Câmbio | "clunk" ao engrenar F/R e ao soltar em N |
| Água, esguicho, cavitação | ruído filtrado ∝ velocidade; fio d'água constante; chiado áspero ∝ cavitação/ventilação |

Limitação: é uma síntese aproximada, não uma gravação. Validar o timbre de ouvido e ajustar os ganhos em `presentation/audio.ts`.

## Roteiro de testes (GDD A.12): resultados de 2026-10-31

`npm run test:sim` (dt = 1/120 s, águas calmas, salvo indicação):

| Teste | Resultado medido |
|---|---|
| 1. Estabilidade (60 s parada) | oscilação vertical 0,0000 m; pitch 0,39°; roll 0°; deriva 0. Com ondas: pitch ≤ 7°, roll ≤ 3° |
| 2. Aceleração | 0→30 km/h em 2,4 s; 0→60 km/h em 5,8 s; velocidade final 77 km/h a 5600 rpm; proa empina ~7,5° a ~17 km/h (hump); planeio a partir de ~25 km/h. Cavitação 0,83 na arrancada e 0 em cruzeiro |
| 3. Trim (acelerador 85 %) | pitch −1: −0,1° / 0: 0,6° / +1: 2,2°; velocidade 83,5 / 72,5 / 63,1 km/h |
| 4. Curva | baixa (22 km/h): raio 5 m. Alta (77 km/h, volante todo): raio 17 m, inclina 2,5° para dentro, perde velocidade |
| 5. Desaceleração e ré | solta o acelerador: do topo a 10 km/h em 12 s; com ré a toda (reverso), em 4,4 s; ré a toda: 23 km/h |
| 4b. Soltar o volante | depois de 3 s de curva a 55 km/h: guinada inversa 0°/s e rumo volta 0° (antes: −10°/s e 16°) |
| Tilt | trim máx navegando: tilt bloqueado e hélice na água; parado: recolhe a 60°, entrada d'água fora, empuxo 0 acelerando; trim− baixa de volta a 0° |
| Tilt engatado | a 12 km/h engatado (1480 rpm): o tilt sobe (12,7° em 2 s). Navegando a 49 km/h: bloqueado |
| Hélice no ar/aflorando | recolhido acelerando: imersão 0, empuxo 0, rpm 5941 com limitador ativo. Meio disco submerso (imersão 0,51): empuxo = 32 % do submerso |
| Motor no chão e acoplamento (v0.27) | baixando o motor na carretinha, o pé nunca entra no chão (folga ≥ 0,04 m) e o motor para apoiado (lancha em 8°, bote em 45° de tilt); bater 5 %, segurar o botão contra o chão por 8 s: 51 %; I desacopla, o carro sai e a carretinha fica parada (0,000 m); longe não acopla; de ré a bola chega a 0,32 m do acoplador e o I acopla; acoplada, a carretinha vem junto |
| Partida e combustível (v0.26) | partida em 2,30 m de água; saindo a toda: folga pé↔fundo 0,54 m (lancha) e 1,13 m (bote), sem avaria. Com 0,25 L / 0,05 L: no ritmo mais econômico o ponto mais longe fica 106 m / 348 m antes do fim do cânion; a toda entram no cânion até z = 254 / 247. Sem combustível: o arranque gira e o motor não pega |
| Combustível × cânion (v0.25) | com o combustível inicial (0,2 L lancha / 0,04 L bote), no acelerador mais econômico e seguindo o rio contra a correnteza, o motor morre ~575 m antes do fim do cânion; com o tanque cheio chegam em 105 s / 199 s; 10 pares de boias laterais, todas em 3 m de água |
| Carro (v0.24) | carro e caminhonete: 50,0 km/h para a frente, 0→45 km/h em 9,0 s / 8,1 s, rodas girando; curva a toda: aceleração lateral 7,85 m/s² (limite μ·g) e sai de frente; devagar não escorrega; roll de 5,7° numa encosta de 10 % (cada roda no relevo) |
| Poita com física e vaga (v0.23) | sem pedras (0 colisores); lancha e bote passando pela poita a 8 km/h e amarrando nela: a boia nunca entra no casco (≤ −0,33 m), fica a ≤ 1,8 m da poita do fundo; quem passa segue em frente (138 m / 80 m); amarra em 13,0 s / 13,6 s; conjunto parado e alinhado dentro da vaga 1 ⇒ estacionado; fora da faixa ⇒ não |
| Atracação e poitas (v0.22) | vaga do píer: lancha amarrada em 13,1 s (folga 0,20 m do píer, 2,6 m do centro da vaga), bote em 16,3 s (folga 0,04 m); sem avaria; poita P2: lancha amarrada em 11,7 s (proa a 0,28 m), bote em 11,9 s (1,86 m); M solta e o barco se afasta (26 m / 17 m em 10 s de ré). Estrada nova: rampa máx. 9,0 %, entrada do pátio 6,4 %; até a bomba: lancha 55,8 s, bote 67,8 s, sem bater |
| Estrada e posto (v0.21) | rampa máx. da estrada 8,9 %; emenda rampa→estrada 12 % (a própria rampa) e entrada do pátio 7 % (sem degraus); com perseguição pura pela estrada, caminhonete+lancha chega parada certa na bomba em 55 s e carro+bote em 68 s, sem bater; carro contra a loja para encostado (2,15 m do centro à fachada); longe da bomba não abastece. No navegador: +9 L em 6 s com a lancha |
| Motor na carretinha (v0.20) | com o barco preso o motor continua ligado (lenta 750 rpm), sem água de refrigeração fora d'água (esquenta 43 °C em 30 s), P desliga e dá partida (autoteste + arranque), quente demais recusa a partida, E/Q mexem no trim/tilt (+25° em 3 s) |
| Recarregar (v0.19) | ciclo completo para lancha e bote: carregar, rebocar 6 s, voltar de ré (o veículo para com as rodas na água), soltar, sair de ré e carregar de novo na carretinha deslocada: encaixa e prende a cinta (lancha 19,7 s, bote 13,7 s), a proa não atravessa o batente, sem avaria (`node tests/debug-reload.ts [lancha|bote]`) |
| Avarias e desengate (v0.18) | lancha contra pedra a 15 km/h: casco 17 %, motor 0 %; a 40 km/h: casco 100 %; raso de 0,75 m a 30 km/h com o motor baixado: motor quebrado, não liga; navegando normal a toda: 0 %; R repara. Subir na carretinha com o motor levantado (trim + 8° de tilt): 0 %; soltar a cinta e dar ré devagar com o motor levantado: sai do berço e flutua a 15 m do guincho, sem avaria. Rebocar com o motor baixado: o pé arrasta (100 %); levantado: 0 % |
| Veículo de reboque (v0.17) | carro e caminhonete: começam com a carretinha exatamente onde estava estacionada; parados na rampa não descem; 8 s acelerando tiram a carretinha da água (traseira 1,9 m acima d'água) a 14–17 km/h, em linha reta alinhada (0°); S freia e engata a ré (−2,5 m/s); de ré virando a carretinha dobra até o batente (80°); andando para a frente realinha (≤4,3°) |
| Neutro no painel, câmbio hidráulico, displays (v0.60) | AR-10: turbina parada com a manete em F → N; em marcha lenta engata F; cortada → volta a N. Bote: punho em N acelera em neutro (+2000 rpm) sem engatar. Um critério antigo ("resfriamento a toda") falhou só porque o bloco novo avançava o relógio das ondas compartilhado — o bloco ganhou água própria, o critério ficou igual. No navegador: bote com o punho em N → 3000 rpm (limite), lanterna acesa, LCD cinza; AR-6 com o botão N armado → N · ACEL 100 %, 3000 rpm, marcha N; AR-10 manete em F com a turbina parada → N e "SEM PRESSÃO", texto longo rolando no display de vidro; AR-9 VFD âmbar |
| Seletor da AR-10, autoteste, starter, manetes (v0.59) | AR-10: BUS em lenta com GEN segue acesa, sem GEN apaga em 0,38 s; BAT (mestre) desligada em lenta apaga; FADEC em OFF e em BUS sem GPU recusam; em BUS com a GPU parte (lenta em 19 s) com a bateria fora (0 A); BUS + GPU com BAT desligada: 0 V. Manual: acima de 60 % N1 o starter continua ligado; esquecido, avisa e desarma em 23 s. Pistão: chave em ON sem bateria fica em silêncio e apita ao ligar a chave geral. No navegador: manete da AR-6 (F 100 %), manetes BB/BE independentes (N / R), punho do bote (F 64 %) e câmbio, potência da AR-10 (F 51 %) e marcha; seletor OFF/BUS/BOTH (BUS sem GPU: 0,9 V e partida recusada; BOTH: 24 V) |
| Sem limite de giro em N (v0.60.4) | AR-6, N + botão a pleno: 5800 rpm (rotação máxima, abaixo do corte de 6100), empuxo 0 N, 0,00 km/h; F só engata com o giro baixo (0,64 s). Bote, punho a 60 % em N: +2988 rpm |
| Chaves de ignição e chave geral (v0.58) | AR-9 com o banco BB zerado em BE: os dois pegam (antes: "bateria fraca"). Chave: ON apita e não gira; START segurada pega em 1,2 s; soltou → ON e ligado; OFF para; engatado recusa; bateria zerada 8 s não pega. AR-9: só a chave BB → só BB; depois BE → os dois. Chave geral OFF com os motores ligados: seguem (alternador). AR-10: BAT off em lenta com GEN: segue acesa; sem GEN: apaga em 0,38 s. No navegador: AR-9 em BE parte pelas chaves (START segurado) e pelo P; com a chave geral em OFF e os motores parados, BOMBA/LUZES em ON com LED apagado ("sem energia"); bote: corda e STOP; AR-10 manual: chaves em ON com LED apagado sem BAT, acendem com BAT |
| Chaves de painel (v0.57) | molinete da AR-10 pagando cabo: −16 A na bateria de 24 V (critério −45…−15 A; no navegador −9,7 → −25,4 A). FADEC com BAT desligada e sem GPU: partida recusada ("noPower"; no navegador o aviso aparece e a fase fica "off"). No navegador: chaves da AR-6 (rotativa ON/OFF), do bote (afogador puxado), da AR-9 (rotativa de 5 posições em BB, registro fechado, bomba em ON girando seca) e da AR-10 (FADEC: BAT/TANQUE/BOMBA; MANUAL: 7 alavancas numeradas, capa no STARTER) |
| Painel de sistemas (v0.56) | registro fechado: a AR-6 em marcha lenta morre em 96 s (combustível da linha), motivo "combustível"; aberto de novo, pega em 2,3 s. Bomba de porão: OFF não tira (80 L), AUTO esvazia, ON liga seca. Afogador (bote frio, 40 tentativas): sem 7 %, com 85 % por puxada; quente com o afogador: afoga em 15 s. AR-9 com o banco BE zerado: IND. 1 motor, BB 2, BE 0, AMBAS iguala a carga e 2, OFF 0. No navegador: painéis da AR-9 (chave com 5 posições), do bote (afogador com a dica de motor frio) e da AR-10 (relógios maiores + sistemas) |
| HUD em duas faixas (v0.55.1) | no navegador: barras + relógios grandes em cima e os pequenos alinhados numa linha embaixo, centralizados, nos 4 barcos (bote 2, AR-6 4, AR-9 6, AR-10 7); a popa e a hélice da AR-10 aparecem acima do HUD |
| Hélice, GPU e layout (v0.55) | GPU: tirando o cabo, fica em "stopping" sem energia e desliga 4,0 s depois. No navegador: tela da GPU ON −0,7 kW → STOPPING 0,0 kW (1500 rpm) → STOP; painel no alto à direita sem tocar o HUD e arrastado para outra posição (salva); câmera com o barco acima dos relógios (popa e hélice visíveis); a hélice nova vista de perto embaixo d'água (render em resolução baixa nessa distância) |
| Temperatura do óleo (v0.54) | na água: 79 °C em marcha lenta (5 min), 91 °C a toda (2 min), sem alarme; fora d'água em marcha lenta: alarme aos 50 s, mancais se desgastando aos 67 s com a turbina ainda rodando (sem corte), 75 % de desgaste em 2,5 min (trava em ~2,7 min se nada for feito). No navegador: relógio ÓLEO °C vermelho com "DANO", etiqueta SUPERAQUECIMENTO e o aviso; a barra de atalhos termina antes dos relógios (635 px × 655 px) e cresce para cima; ajuda compacta à esquerda |
| Água de resfriamento (v0.53) | turbina parada: 0 L/s; só o starter (N1 ~17 %): 0,50 L/s; marcha lenta: 1,86 L/s; a toda: 2,90 L/s. No navegador: starter a 10 % N1 sem fumaça no escape; em marcha lenta (1,85 L/s) o jato sai pelo espelho (bombordo), cai em arco e faz espuma na água |
| Periféricos, energia e EXT PWR (v0.52) | bomba + velas + FADEC só na bateria: −12,7 A (24 V); sem barramento: chave da ignição em ON mas sem faísca e instrumentos sem energia; manual com a GPU estável e o EXT PWR aberto: barramento 0 V; fechando o EXT PWR: o starter gira (N1 18,3 %); FADEC abre o EXT PWR na marcha lenta com o cabo ainda conectado (GPU ON, 0 kW); partida quente agora na faixa de 42–45 % de bateria (a 43 %: aborta a 780 °C; a 60 %: pega com pico de 681 °C). No navegador: chave IGNIÇÃO em ON sem barramento = luz apagada e relógios "sem energia"; BAT + BOMBA ligadas: barramento 24,3 V e amperímetro −12,7 A; painel com os 7 relógios analógicos com faixas |
| Barramento, GEN e defeitos (v0.51) | BAT desligada + GPU: o starter gira (N1 18 %) com o barramento a 26,6 V; marcha lenta no manual com GEN desligado: bateria −0,1 A (não carrega); GEN ligado: +15 A; BAT desligada com a turbina rodando: barramento 27,8 V pelo gerador, bateria 0 A e carga inalterada, turbina segue rodando; combustível cedo (N1 6 %): EGT 883 °C; partida molhada: 1.205 °C; starter > 40 s: superaquece e trava (não religa quente); desgaste ≥ 95 %: turbina trava e o reparo zera. No navegador: painel no canto inferior direito com BAT/EXT PWR/GEN; GPU: fumaça na partida, tela STABILIZING (1403 rpm) → ON −0,4 kW → ON −4,9 kW com o starter engatado e baforada escura |
| Partida manual, GPU a diesel (v0.50) | GPU: o diesel estabiliza e chaveia a energia em 4,5 s; enquanto parte, o barramento continua na bateria (23,9 V). Manual: o P não dá partida; com a BATERIA desligada o starter não gira (N1 0 %); sequência certa chega à marcha lenta em 20,5 s com pico de EGT 655 °C; partida molhada (8 s de combustível sem ignição = 0,10 L na câmara) acende com labareda e EGT 966 °C, sobretemperatura e desgaste; starter solto a 25 % = rollback (não passa de 40 %, EGT 857 °C). No navegador: splash como imagem sem erros; GPU só com a AR-10; ao conectar, luz piscando e 24,7 V → estável em 28,0 V com EXT PWR verde; partida manual clicando no painel (starter, a 12,1 % ignição e combustível, a 45,1 % starter e ignição desligados) até a marcha lenta (N1 61,8 %, EGT 484 °C), com a GPU desconectada sozinha |
| GPU da doca e splash (v0.49) | AR-10 com a bateria a 15 % (sozinha: partida pendurada) e a GPU: pega e chega à marcha lenta em 19,1 s, pico de EGT 629 °C (mais fria), barramento mínimo 25,3 V, a GPU é desconectada sozinha na marcha lenta e a bateria carrega +3,4 pontos de % durante a partida. No navegador: GPU conectada atracado (28,0 V, +13 A, lâmpada verde, cabo do carrinho à tomada), desconecta na marcha lenta, reconecta atracado e cai ao soltar as amarras; splash sem erros no console, o card da AR-10 abre a escolha já com ela selecionada, English com SOON não muda nada |
| Lancha de turbina AR-10 (v0.48–0.48.2) | partida a frio com a bateria a 60 %: arranque → ignição e combustível a 12,0 % N1 → acende 1,1 s depois → arranque desliga a 45 % → marcha lenta em 20,6 s; pico de EGT 659 °C; sistema de 24 V: tensão mínima 19,4 V no arranque, 27,8 V em marcha lenta com o gerador carregando (+15 A); marcha lenta: N1 62 %, EGT 484 °C, óleo 70 psi, o starter-gerador carrega +30 A. Cortada: nova partida recusada com o N1 alto; N1 abaixo de 8 % em 18 s. Bateria a 40 %: partida quente (EGT 780 °C, combustível cortado); a 15 %: pendurada (não acende); sem combustível: não acende. A toda: 150 km/h, 0→100 em 9,1 s, N2 99,9 %, EGT 631 °C, 434 L/h, imersão média da hélice 0,48. Sem carga a toda: o governador segura o N2 em 103 %. Virou: ninguém na água (habitáculo fechado) e a turbina apaga. Carretinha (`node tests/debug-trailer.ts turbina`): sobe e prende a cinta, sem avaria. No navegador: a mesma sequência (acende aos ~5 s, marcha lenta aos ~22 s), 147 km/h a toda com N1 98 % e EGT 630 °C; menu com as 4 embarcações, sem erros no console |
| Lancha rápida AR-9, dois V8 (v0.47–0.47.1) | dois bancos: com o 1º já ligado, o arranque do 2º não mexe no banco 1 (13,5 V); banco de boreste zerado: só bombordo pega; só bombordo ligado 3 min: 54 °C contra 29 °C do desligado, e o banco de boreste não carrega (−0,3 A); no navegador, as duas hélices emitem (1,1 m entre os jatos), esguicho 0. 8,6 m, 2.500 kg seca, 2 × 300 hp (rabetas a ±0,55 m do centro): máx. **96,6 km/h**, 0→60 km/h em 4,3 s, os dois motores no mesmo giro a toda (0 rpm de diferença), 210 L/h a pleno; **empuxo diferencial** (BB em ré 45 %, BE à frente 18 %) por 10 s: gira 69° para bombordo e se desloca só 3 m; invertido: 69° para boreste; só o motor de boreste a 60 %: 49 km/h e a proa cai para bombordo (3 °/s); chave liga os dois **um de cada vez** (o 2º pega 1,5 s depois do 1º); largada com a bateria a 60 %: os dois pegam em 3,4 s, tensão mínima 10,3 V (banco de 100 Ah). Carretinha de 8,6 m (`node tests/debug-trailer.ts rapida`): sobe e assenta centralizada (0,00 m, 6,3°); sem levantar a rabeta, o pé raspa na rampa (motor 6 %). No navegador: os dois V8 pegam em sequência, Z por 8 s gira 32° junto ao píer, a toda 98 km/h com os dois a 4.940 rpm |
| Barco virado (v0.46) | casco inteiro: a bolsa de ar segura o barco virado (2.657 L de ar após 3 min, não afunda); casco 30 %: o ar escapa pelo furo e afunda em 41 s; casco 100 %: em 9 s; afundou: as 3 pessoas se juntam (no máx. 0,89 m entre elas); bote inflável virado e furado: não afunda |
| Barranco e cânion (v0.45) | a toda contra a parede do cânion: sobe no máx. 2,3 m (antes subia a parede até 13 m e ficava lá) e a gravidade traz o barco de volta à água em ~5 s; batida de frente a ~40 km/h: casco 92 %; parado numa encosta de ~35°: escorrega 6 m em 4 s |
| Ré e espelho (v0.43) | ré a toda em água calma: 9,0 km/h (antes ~25 km/h); lago, ré a toda CONTRA as marolas 30 s: 133 L entram e ficam; a FAVOR das marolas: 0 L; lago, ré a 50 %: 0 L; ondas fortes, ré lenta 60 s: 39 L; mar forte em círculo: até ~60 L/min pelos cantos de ré nas curvas |
| Superfície livre e drenos (v0.42) | lancha com 1.500 L: água calma, 3 min = flutua com 36 cm de borda livre; ondas fortes, 3 min = vira (a água solta corre para o lado baixo); 1.000 L com ondas fortes embarca +845 L em 3 min; alagada com 2.867 L, afunda com 3.852 L (calma); furo de 60 % equilibra com 209 L; ré a toda em água calma entra ~4 L pelos drenos |
| Jato da bomba (v0.41.1) | linha de emissão no referencial do barco: parado sai 0,21 m para fora em 0,31 s de queda e não vai para proa nem popa; andando (~29 km/h) curva 0,42 m para a popa e continua saindo para fora; saída em bombordo vai para bombordo |
| Alagar, afundar e jato (v0.41) | lancha (só o piloto, água calma): seca 64 cm de borda livre; borda livre < 20 cm com ~2500 L; ALAGADA/inavegável (borda de ré na linha d'água) com 3475 L; AFUNDA com 3884 L (a água passa a entrar pelo espelho sem parar e o peso passa do empuxo máximo do casco, 8,5 t); afundou: motor desligado, pessoas na água, o barco desce. Bote inflável cheio até o topo dos tubos (1070 L): não afunda. Furo de 60 % por 10 min sem bomba: a água iguala o nível de fora (892 L) e o barco não afunda. Bomba: 0,55 L/s com ~0,8 m de coluna; jato sai a 0,84 m/s |
| Entrada de água e bomba (v0.40) | bomba de ~750 GPH: 0,82 L/s, −3,8 A. Furo (orifício): casco 17 % entra 0,47 L/s e a bomba dá conta (máx 6 L); 60 %: 200 L em 2 min, a lancha afunda 1,8 cm; 100 %: 241 L em 1 min. Borda/espelho (vertedouro): água calma, ré a toda: 0 L; lago, ré 50 %: 8 L; ondas fortes, ré lenta: 8,5 L; ondas fortes, ré 50 %: alaga (900 L em 30 s). Mar forte navegando em círculo: 0,5–7 L (respingos) |
| Alternador (v0.39) | lenta (750 rpm): +9,2 A, 1 min recupera 3,0 % da bateria; cruzeiro com a bateria a 70 %: +21 A (a corrente cai perto da carga cheia); em lenta a bomba do trim (30 A) derruba a tensão 0,62 V; em cruzeiro o alternador de 35 A cobre o trim (0,00 V) |
| Fundo do lago (v0.38) | centro e a 100 m dele: 7,0 m (antes 2–3,3 m); mar forte, 1 min em círculo no meio do lago a 30/60/100 %: avaria do motor 0 % na lancha e no bote (antes a lancha chegava a 100 % e 57 %) |
| Vento (v0.36) | sem vento: deriva 0; rajadas proporcionais ao nível; deriva da lancha parada cresce com o nível; tempestade (~37 nós): banda 2,9°, a proa cai a sotavento e em regime a lancha deriva a 1,42 m/s com 4° de desvio do vento; ancorada com ~5:1 não ara; com 6 m (~1,3:1) garra 23,6 m em 1 min |
| Booster 10 Ah / 200 A (v0.35) | com a bateria zerada dá 20 partidas até esvaziar; alimenta o molinete (16 m de cabo em 20 s, gasta 1,52 Ah); partida + molinete recolhendo passam de 200 A e a proteção desarma; conectado com o motor já ligado continua conectado; 2 min em cruzeiro recarregam 3,3 Ah |
| Amperímetro, porão e âncora (v0.34) | amperímetro: −0,3 A desligado, −170 A na partida, −30 A no trim, +14,7 A em cruzeiro. Âncora (fundo de 3 m): 16 s pagando = 12,8 m, molinete −27 A; ré lenta 30 s: unha e segura; filame ~4:1 com ré a 50 % por 15 s ara só 0,33 m; com 1,4:1 garra 11 m; recolhendo puxa o barco (pico −70 A) e guarda; bateria zerada: só o relé; bote à mão: 7 m em 10 s, 0 A. Porão: casco 30 % entra 0,33 L/s, a boia liga a bomba (1,23 L/s, −4,8 A), máx. 6 L, alarme; casco 100 % entra mais que a bomba (97 L em 2 min) e a água pesa; bote sem bomba: 19,7 L em 1 min |
| Booster e largada (v0.33) | largada com a bateria a 60 %: pega em 2,92 s; o booster se desconecta sozinho quando o motor pega; booster cheio dá 3 partidas com a bateria zerada (a 4ª não vai) e fica em 0 %; 1,5 min em cruzeiro o recarrega para 99 %; em marcha lenta não recarrega |
| Bateria zerada, jump start e neutro (v0.32) | zerada: 10,19 V em repouso; trim/tilt parado (0,000°), só o relé estala (1,5 A); partida recusada. Com o jump start: 12,52 V, o trim volta a mover (5,7° em 1,5 s), o motor pega em 1,97 s e 1 min navegando recarrega 4,8 %. Neutro: sem o botão o acelerador é ignorado (750 rpm); com N segurado o giro vai a 3000 rpm (limite), empuxo 0 N, 0,00 km/h; F só engata 0,64 s depois, com o giro baixo |
| Embarque no píer (v0.31) | largada amarrada na vaga (lancha e bote): 2,30 m de água; lotado e amarrado 30 s: desloca 0,17 m (lancha) / 0,25 m (bote), sem avaria; soltando e saindo a toda: folga do pé ao fundo 0,56 m / 0,87 m, sem avaria |
| Rampa e carretinha (v0.16) | rampa com 12 % (1,20 m em 10 m) e linha d'água no início; piloto automático simples (lenta engatada + toques, ~2–4 km/h) a 0,4 m do eixo: lancha encaixa em 16,9 s e bote em 16,1 s, centralizados (0,00 m), inclinados como a rampa (6,7°), sem adernar (≤0,6°), física estável; com a cinta presa e o motor desligado não escorregam (≤3 cm em 20 s). Muito desalinhada (1,5–2,5 m), a lancha não encaixa com esse piloto automático (vira devagar em baixa velocidade); o bote encaixa |
| Emborcamento (v0.14–0.15) | bote com 2 pessoas virado à força: detectado, 2 pessoas na água, motor desligado (kill switch), −160 kg no barco, colete a 5 cm da linha d'água, pessoas fora do casco; em 30 s nadaram até o barco (a 0,54 m do casco, nenhuma dentro) e pararam de nadar; sem piloto, acelerador/direção/trim não mexem o barco e P responde "noPilot"; R volta tudo ao normal. Trim manual do bote: recusado acelerando, aceito deslizando sem acelerar |
| Bote de apoio (v0.13) | 202 kg com o piloto e 6 L; banda de 1,8° com o piloto em boreste; máx 43,8 km/h (planando), 0→30 em 3,4 s, 5,5 L/h; curva a toda com a cana: roll máx 2,9°, fica de pé; lotado (3): 33,3 km/h; ondas fortes lotado: up.y mín 0,85. Trim manual: começa no pino 2, E → pino 3 (+4,0°) de forma progressiva (1,75° no meio do caminho), E de novo → tilt 70° (35° após 0,6 s), hélice fora d'água, sem corrente de bomba; Q volta ao pino 1 (−4°); andando, a troca é recusada. Sem bateria (0 V); corda: pega em poucas puxadas |
| Bateria e partida (v0.12) | apito 1,1 s; bateria boa: arranque 256 rpm, 10,5 V, pega em ~2,2 s (com o apito); 65 %: pega em ~2,6 s; 40 %: 118 rpm, não pega em 4 s; 10 %: não pega; 12 partidas seguidas: −12 %; 40 s de tilt com o motor desligado: −10 % e arranque cai para 172 rpm; 1 min navegando: +4,8 % |
| Carga | só piloto + 30 L: 1132 kg; lotada + 120 L: 1439 kg. Lotada afunda 2,9 cm a mais, faz o 0→60 em +3,0 s e perde 6,4 km/h de máxima; 2 na popa: a proa sobe +0,74° parada; piloto sozinho em boreste: banda de 0,48° para boreste; com o carona em bombordo: 0,0° |
| Sistemas do motor | 2 min a toda: 1,82 L, 0,0333 h no horímetro, 60,8 °C, 14,2 V. Recolhido e ligado: proteção aos 28 s, desliga sozinho aos 60 s, partida recusada quente, abaixo de 90 °C após 3 min. Sem combustível: morre e não pega; bateria em repouso 12,6 V |
| Ignição | desliga em movimento; desligado, empuxo 0 mesmo acelerando; RPM vai a 0; partida engatado é recusada; em N dá partida e pega na lenta (750–1200 rpm) |
| 5. Manete | de cruzeiro para N: empuxo 0 e < 1 km/h em 27 s; a hélice gira **solta** (~990 rpm 1,5 s depois do N) e para junto com a lancha. F em lenta: 5,0 km/h a 750 rpm. R em lenta: 2,8 km/h para trás. No navegador: 1 toque W = F a 4 km/h; segurar = 45 km/h; 1 toque S = N; 2º toque = R lenta; segurar S = ré acelerando |
| 6. Ondas e correnteza | ondas fortes (×2,5): roll ≤ 30°, não emborca; deriva com correnteza de 1,6 m/s: 1,54 m/s |
| Lago | flutua no spawn; a toda contra a margem, encalha e para sem atravessar o terreno |

Resultado: **586/588 OK + 2 KNOWN** (v0.64.1). Na v0.10, o peso do piloto na posição real (boreste, acima do CG) aumentou o roll em curva com ondas fortes; o `bankCoef` foi para 1800 e o `rollDamping` para 15000, com 1 limitação conhecida (abaixo). Na v0.2 a hélice foi para 0,5 m atrás do espelho, como no modelo visual, e o esterço máximo em alta velocidade caiu de 13° para 11°.

### Navegador (Chrome, Windows 11, WebGL2, `q=med`, ~1370×896)

- A cena fica pronta em **~450–840 ms** no servidor de desenvolvimento local (v0.2). Na v0.48, com as 4 embarcações e o mundo completo, **2,7–6,8 s** no servidor de desenvolvimento (Vite sem bundle; inclui compilar os shaders).
- v0.48.2 (Chrome automatizado pela extensão, 1775×1218, `med`, 388 malhas ativas): **27–45 FPS** parado no píer, com bastante variação entre medições na mesma máquina; a fumaça da turbina no acendimento (~850 partículas) custou ~2 FPS (45 → 43). Precisa ser medido de novo sem a automação ligada.
- v0.1: **~86 FPS** navegando a 66 km/h. A física custa **0,14 ms/frame**.
- v0.2 (reflexo planar, mapa de esteira 512², PBR): **~85 FPS** a 1775×1161, com 94 malhas ativas.
- A convenção de quaternions da simulação bate com a da Babylon (verificado em `__aqua.checkConvention()`).
- Funcionou: aceleração, planeio, curva com esteira curvando, câmera de cockpit, HUD com dados reais e UI touch (`?touch=1`).
- **Ainda não medido**: celular real, WebGPU, aquecimento e memória (testes 9 e 10 do GDD).

## Limitações conhecidas (honestas)

1. **Ângulo de planeio baixo**: em velocidade final a lancha roda com ~0,6° (uma lancha real roda com 3–5°). O pico do hump (8°) está correto. O teste marca isso como `KNOWN`.
2. **Trim × velocidade invertido**: trim − deixa a lancha *mais rápida* no modelo. Na prática, um trim + moderado costuma ganhar velocidade. A atitude responde corretamente ao trim. Próximo passo: modelo de comprimento molhado (Savitsky) no lugar da saturação por ponto.
3. **Bundle grande**: 6,6 MB (1,5 MB gzip) no arquivo principal e 7,7 MB no total (v0.48.2), porque importa `@babylonjs/core` inteiro. Dá para otimizar com imports por caminho na fase P5.
4. Em `low` não há reflexo planar (só o céu). Sem dia/noite nem chuva (o vento existe desde a v0.36, sem ondas de vento no lago).
5. Colisão por pontos: um objeto fino entre dois pontos de contato pode atravessar o costado.
6. **Rolagem em ondas fortes com água no porão** (v0.46.1, KNOWN no teste 6): desde a v0.43 a lancha embarca 200–330 L nesse cenário (curva a 80 % no mar forte) e o peso extra deixa os picos de rolagem em ~40–42° (sem água: 32,9°). Ela não emborca. O GDD não fixa número para o teste 6; o limite de 40° era nosso.
7. **AR-9 sem chave de paralelo de baterias** (v0.47.1): cada V8 tem o seu banco; com o banco de boreste zerado só o motor de bombordo pega e não há como ligar os dois bancos (barcos reais têm a chave de emergência). O jump start liga só no banco de bombordo.
8. **Painel 3D da AR-9 e da AR-10 é o da AR-6** (velocímetro até 100 km/h e conta-giros). Os instrumentos certos (dois conta-giros; N1, EGT, torque, N2, óleo) estão só no HUD.
9. **Turbina**: modelo de desempenho simplificado (curvas de N1, EGT e torque calibradas para o comportamento esperado, não tiradas de um manual de turbina). O sistema de 24 V é o mesmo modelo elétrico de 12 V com a escala ×2/÷2 na telemetria. A hélice de superfície usa a imersão como única variável (sem modelo de ventilação por pá); o trim + não deixa a AR-10 mais rápida (mesma causa da limitação 2).
10. ~~Combustível, danos e porão ainda não existem~~: resolvidos (v0.9, v0.18, v0.34–v0.41). O empuxo é por 6 pontos de área constante: bate com o volume do casco desenhado até a borda, mas não modela compartimentos estanques separados (a água de dentro é uma carga só).
11. ~~A física não sente a esteira~~: resolvido na v0.5 (`WaterWithWake`). A espuma continua só visual.
12. ~~Adesivo "60" × física de 150 hp~~: resolvido na v0.7 (o adesivo lê `enginePowerHp`).
13. As bolhas são partículas desenhadas antes da água. Com a água vidro e muito transparente, a profundidade delas é aproximada.

## Próximos passos (POC 1)

- [ ] Medir em celular Android/iOS real (FPS, aquecimento) e WebGPU
- [ ] Corrigir o ângulo de planeio e o efeito do trim na velocidade (limitações 1 e 2)
- [ ] Reduzir o bundle (imports por caminho) e medir o tempo de carregamento em produção
- [x] Publicar o `dist/` (GitHub Pages) para testar por URL no celular (`npm run deploy`)
- [ ] Voltar o combustível inicial ao valor de jogo (hoje 5 L na lancha e no bote, 20 L na AR-9 e 120 L na AR-10, temporários para testes) e calcular o valor da AR-9 e da AR-10
- [ ] Painel 3D próprio da AR-9 (dois conta-giros) e da AR-10 (instrumentos de turbina) e chave de paralelo de baterias na AR-9
- [ ] Botões touch para o empuxo diferencial (Z/X) da AR-9
- [ ] Atividades do GDD (wakeboard, esqui, boia, parasail, banana boat, passeio, desafios): hoje só na ilustração da splash
- [ ] Tradução para inglês (o seletor já existe, com o selo SOON)
- [ ] Gravar vídeo do roteiro de testes para a matriz comparativa
