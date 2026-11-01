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
    world.ts                relevo do lago (função), rochas/píer (colisores), zona de correnteza
    params.ts               PARÂMETROS DOCUMENTADOS da lancha (contrato comum entre as 3 POCs)
    engineSystems.ts        combustível, arrefecimento, bateria/alternador, horímetro
    wake.ts                 histórico da esteira (física + visual)
    boat.ts                 corpo rígido 6DOF + SpeedboatController (forças e torques)
  gameplay/vehicleInput.ts  contrato VehicleInput (GDD 9.2)
  platform/input.ts         adaptadores teclado / gamepad / touch → VehicleInput
  presentation/             WATER RENDERING + INTERACTION + UI
    waterMaterial.ts        shader GLSL: MESMAS ondas da física + esteira + reflexo planar + vidro
    wakeMap.ts              mapa de esteira top-down (V de Kelvin, espuma da hélice, fervura de cavitação)
    waterInteraction.ts     orquestra o mapa de esteira + partículas (spray, rooster tail, bolhas, névoa)
    environment.ts          terreno, rochas, árvores, píer, marina
    boatMesh.ts             lancha procedural detalhada (PBR), motor e hélice de 3 pás
    helm.ts                 posto do piloto: painel com instrumentos, volante, manete F/N/R, chave
    pilot.ts                piloto com braços por IK (mãos no volante e na manete)
    cameras.ts              externa (mola + órbita) e cockpit
    hud.ts                  HUD que lê só a telemetria real
    audio.ts                motor/água procedurais (Web Audio)
  main.ts                   bootstrap + laço com física em passo fixo e render interpolado
tests/
  sim.test.ts               roteiro GDD A.12 (testes 1–6 + lago) headless, com PASS/FAIL
  debug-*.ts                scripts de diagnóstico (curva, forças por ponto, trim)
```

## Modelo físico (resumo)

A lancha é um **corpo rígido 6DOF** (massa de 1200 kg, tensor de inércia diagonal), integrado por Euler semi-implícito a **120 Hz em passo fixo**. Não há `Translate`: tudo são forças e torques. Os parâmetros ficam em `src/sim/params.ts`.

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
| Sistemas do motor (v0.9) | **Combustível**: tanque de 120 L, consumo pela carga (3 L/h em lenta a ~55 L/h a toda); perto do fim o motor engasga e depois morre; sem combustível não pega. **Temperatura**: termostato ~58–64 °C (aquece em ~1–2 min); sem água na entrada do pé sobe ~2 °C/s → alarme a 85 °C, **proteção a 90 °C** (limita a 2000 rpm e 30 % de acelerador), **desliga a 115 °C**; desligado esfria devagar e só pega abaixo de 90 °C. **Bateria** de 50 Ah (v0.12): 11,9–12,7 V em repouso, regulador 13,6–14,2 V com o alternador (> 900 rpm). Resistência interna de 9 mΩ (cheia) a ~39 mΩ (vazia): na partida (170 A) a tensão cai ~2 V com ela cheia e ~4 V a 40 %. Rotação do arranque = 260 rpm × (V − 7,5)/3,1; o motor pega depois de 3 a 5 voltas "úteis" (rotação de compressão > 60 rpm) e a tentativa desiste após 4 s ("não pegou"). Abaixo de 3 % nem o relé arma. Carga e descarga com **aceleração de jogo de 10×** (`batteryTimeScale`), documentada em `engineSystems.ts`. Autoteste de 1,1 s com apito antes do arranque. **Horímetro** soma o tempo ligado (salvo no navegador) |
| Cavitação | índice = f(carga × escorregamento da hélice). Com carga alta e pouca velocidade (arrancada), perde até 30 % do empuxo e o RPM sobe. Some em cruzeiro |
| Hélice × superfície (v0.8) | **imersão** = fração do disco (R = 0,19 m) dentro d'água; empuxo × imersão^1,5. **Aeração**: com o disco raso a hélice puxa ar e perde até 50 % a mais. **No ar**: sem carga, o motor sobe até o **limitador** (6100 rpm), que corta a ignição em pulsos (som de "bap-bap"). Em N a hélice gira solta: freada pela água quando imersa, quase sem freio no ar |
| Agarre lateral do casco | sustentação lateral da quilha/strakes ∝ u·v_lateral, aplicada perto do CG (sem efeito cata-vento), mais amortecimento de guinada. A lancha derrapa ~7° numa curva forte e, ao soltar o volante, a guinada morre em ~0,7 s **sem voltar para o lado oposto** (antes voltava ~16°) |
| Inclinação em curva | torque ∝ aceleração centrípeta (casco em V) + amortecimento de rolagem |
| Colisões | penalidade mola-amortecedor com atrito em 12 pontos de contato contra o fundo (função de altura), as rochas (esferas) e o píer (caixas) |
| Correnteza e ondas | a velocidade relativa à água usa a correnteza; as alturas vêm das mesmas ondas de Gerstner do shader |

**Água compartilhada:** `GerstnerWater.shaderParams()` envia ao shader exatamente as ondas que a física consulta. `getHeight` inverte o deslocamento horizontal de Gerstner por iteração de ponto fixo. No teste, o desvio médio entre o casco e a superfície é de 3 cm.

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

Resultado: **358/359 OK** (v0.35.0). Na v0.10, o peso do piloto na posição real (boreste, acima do CG) aumentou o roll em curva com ondas fortes; o `bankCoef` foi para 1800 e o `rollDamping` para 15000, com 1 limitação conhecida (abaixo). Na v0.2 a hélice foi para 0,5 m atrás do espelho, como no modelo visual, e o esterço máximo em alta velocidade caiu de 13° para 11°.

### Navegador (Chrome, Windows 11, WebGL2, `q=med`, ~1370×896)

- A cena fica pronta em **~450–840 ms** no servidor de desenvolvimento local.
- v0.1: **~86 FPS** navegando a 66 km/h. A física custa **0,14 ms/frame**.
- v0.2 (reflexo planar, mapa de esteira 512², PBR): **~85 FPS** a 1775×1161, com 94 malhas ativas.
- A convenção de quaternions da simulação bate com a da Babylon (verificado em `__aqua.checkConvention()`).
- Funcionou: aceleração, planeio, curva com esteira curvando, câmera de cockpit, HUD com dados reais e UI touch (`?touch=1`).
- **Ainda não medido**: celular real, WebGPU, aquecimento e memória (testes 9 e 10 do GDD).

## Limitações conhecidas (honestas)

1. **Ângulo de planeio baixo**: em velocidade final a lancha roda com ~0,6° (uma lancha real roda com 3–5°). O pico do hump (8°) está correto. O teste marca isso como `KNOWN`.
2. **Trim × velocidade invertido**: trim − deixa a lancha *mais rápida* no modelo. Na prática, um trim + moderado costuma ganhar velocidade. A atitude responde corretamente ao trim. Próximo passo: modelo de comprimento molhado (Savitsky) no lugar da saturação por ponto.
3. **Bundle grande**: 6,3 MB (1,4 MB gzip), porque importa `@babylonjs/core` inteiro. Dá para otimizar com imports por caminho na fase P5.
4. Em `low` não há reflexo planar (só o céu). Sem dia/noite; sem chuva nem vento.
5. Colisão por pontos: um objeto fino entre dois pontos de contato pode atravessar o costado.
6. Combustível, danos e porão ainda não existem (o HUD só mostra o consumo estimado).
7. ~~A física não sente a esteira~~: resolvido na v0.5 (`WaterWithWake`). A espuma continua só visual.
9. ~~Adesivo "60" × física de 150 hp~~: resolvido na v0.7 (o adesivo lê `enginePowerHp`).
8. As bolhas são partículas desenhadas antes da água. Com a água vidro e muito transparente, a profundidade delas é aproximada.

## Próximos passos (POC 1)

- [ ] Medir em celular Android/iOS real (FPS, aquecimento) e WebGPU
- [ ] Corrigir o ângulo de planeio e o efeito do trim na velocidade (limitações 1 e 2)
- [ ] Reduzir o bundle (imports por caminho) e medir o tempo de carregamento em produção
- [ ] Publicar o `dist/` (GitHub Pages) para testar por URL no celular
- [ ] Gravar vídeo do roteiro de testes para a matriz comparativa
