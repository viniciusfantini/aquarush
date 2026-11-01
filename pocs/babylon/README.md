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
    boat.ts                 corpo rígido 6DOF + SpeedboatController (forças e torques)
  gameplay/vehicleInput.ts  contrato VehicleInput (GDD 9.2)
  platform/input.ts         adaptadores teclado / gamepad / touch → VehicleInput
  presentation/             WATER RENDERING + INTERACTION + UI
    waterMaterial.ts        shader GLSL: MESMAS ondas da física + esteira + reflexo planar + vidro
    wakeMap.ts              mapa de esteira top-down (V de Kelvin, espuma da hélice, fervura de cavitação)
    waterInteraction.ts     orquestra o mapa de esteira + partículas (spray, rooster tail, bolhas, névoa)
    environment.ts          terreno, rochas, árvores, píer, marina
    boatMesh.ts             lancha procedural detalhada (PBR), painel com ponteiros, motor e hélice de 3 pás
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
| Trim | inclina o vetor de empuxo e age como flap da rabeta (força ∝ u² na popa). **Muda a atitude e a velocidade de fato** |
| Manete F / N / R | a marcha pedida vem de `VehicleInput.gear`. Toda troca passa por N com 0,45 s (embreagem da rabeta) e só engrena com o acelerador em lenta. Em N o empuxo é zero. Engrenado em lenta, o motor dá 4 % do empuxo (≈ 5 km/h para frente e ≈ 3 km/h em ré) |
| Cavitação | índice = f(carga × escorregamento da hélice). Com carga alta e pouca velocidade (arrancada), perde até 30 % do empuxo e o RPM sobe. Some em cruzeiro |
| Ventilação | a hélice perto da superfície (trim alto, saltos) perde empuxo e dispara o RPM |
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
- **Esguicho de refrigeração (tell-tale):** bico no capô inferior (boreste) com jato contínuo de gotas; a velocidade e a vazão sobem com o RPM (bomba d'água). O jato herda a velocidade da lancha.

## Áudio (v0.4): motor de popa 4 tempos, 4 cilindros (~60 hp)

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
| 5. Manete | de cruzeiro para N: empuxo 0 e < 1 km/h em 27 s. F em lenta: 5,0 km/h a 750 rpm. R em lenta: 2,8 km/h para trás. No navegador: 1 toque W = F a 4 km/h; segurar = 45 km/h; 1 toque S = N; 2º toque = R lenta; segurar S = ré acelerando |
| 6. Ondas e correnteza | ondas fortes (×2,5): roll ≤ 30°, não emborca; deriva com correnteza de 1,6 m/s: 1,54 m/s |
| Lago | flutua no spawn; a toda contra a margem, encalha e para sem atravessar o terreno |

Resultado: **48/49 OK**, com 1 limitação conhecida (abaixo). Na v0.2 a hélice foi para 0,5 m atrás do espelho, como no modelo visual, e o esterço máximo em alta velocidade caiu de 13° para 11°.

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
7. A física **não sente a esteira**: a lancha não pula a própria marola nem a de outra. A esteira é só visual, gerada a partir da física.
9. O capô diz **"60"**, mas a física simula **150 hp** (`params.ts`). Mudar para 60 hp reduz a velocidade final e o planeio; está pendente de decisão.
8. As bolhas são partículas desenhadas antes da água. Com a água vidro e muito transparente, a profundidade delas é aproximada.

## Próximos passos (POC 1)

- [ ] Medir em celular Android/iOS real (FPS, aquecimento) e WebGPU
- [ ] Corrigir o ângulo de planeio e o efeito do trim na velocidade (limitações 1 e 2)
- [ ] Reduzir o bundle (imports por caminho) e medir o tempo de carregamento em produção
- [ ] Publicar o `dist/` (GitHub Pages) para testar por URL no celular
- [ ] Gravar vídeo do roteiro de testes para a matriz comparativa
