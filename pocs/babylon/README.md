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
    waterMaterial.ts        shader GLSL com as MESMAS ondas da física
    waterInteraction.ts     esteira (faixa de espuma) e spray (partículas)
    environment.ts          terreno, rochas, árvores, píer, marina
    boatMesh.ts             lancha procedural (casco em V, motor que esterça e faz trim)
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
| Inclinação em curva | torque ∝ aceleração centrípeta (casco em V) + amortecimento de rolagem |
| Colisões | penalidade mola-amortecedor com atrito em 12 pontos de contato contra o fundo (função de altura), as rochas (esferas) e o píer (caixas) |
| Correnteza e ondas | a velocidade relativa à água usa a correnteza; as alturas vêm das mesmas ondas de Gerstner do shader |

**Água compartilhada:** `GerstnerWater.shaderParams()` envia ao shader exatamente as ondas que a física consulta. `getHeight` inverte o deslocamento horizontal de Gerstner por iteração de ponto fixo. No teste, o desvio médio entre o casco e a superfície é de 3 cm.

## Roteiro de testes (GDD A.12): resultados de 2026-10-31

`npm run test:sim` (dt = 1/120 s, águas calmas, salvo indicação):

| Teste | Resultado medido |
|---|---|
| 1. Estabilidade (60 s parada) | oscilação vertical 0,0000 m; pitch 0,39°; roll 0°; deriva 0. Com ondas: pitch ≤ 7°, roll ≤ 3° |
| 2. Aceleração | 0→30 km/h em 2,0 s; 0→60 km/h em 5,4 s; velocidade final 77 km/h a 5600 rpm; proa empina 8,2° a ~18 km/h (hump); planeio a partir de ~26 km/h |
| 3. Trim (acelerador 85 %) | pitch −1: 0,0° / 0: 0,6° / +1: 2,0°; velocidade 82,5 / 72,5 / 63,6 km/h |
| 4. Curva | baixa (22 km/h): raio 6 m. Alta (77 km/h, volante todo): raio 24 m, inclina 2,3° para dentro, perde velocidade |
| 5. Desaceleração e ré | solta o acelerador: do topo a 10 km/h em 12 s; com freio/reverso, em 4,4 s; ré a 23 km/h |
| 6. Ondas e correnteza | ondas fortes (×2,5): roll ≤ 30°, não emborca; deriva com correnteza de 1,6 m/s: 1,54 m/s |
| Lago | flutua no spawn; a toda contra a margem, encalha e para sem atravessar o terreno |

Resultado: **41/42 OK**, com 1 limitação conhecida (abaixo).

### Navegador (Chrome, Windows 11, WebGL2, `q=med`, ~1370×896)

- A cena fica pronta em **~450–840 ms** no servidor de desenvolvimento local.
- **~86 FPS** navegando a 66 km/h. A física custa **0,14 ms/frame**.
- A convenção de quaternions da simulação bate com a da Babylon (verificado em `__aqua.checkConvention()`).
- Funcionou: aceleração, planeio, curva com esteira curvando, câmera de cockpit, HUD com dados reais e UI touch (`?touch=1`).
- **Ainda não medido**: celular real, WebGPU, aquecimento e memória (testes 9 e 10 do GDD).

## Limitações conhecidas (honestas)

1. **Ângulo de planeio baixo**: em velocidade final a lancha roda com ~0,6° (uma lancha real roda com 3–5°). O pico do hump (8°) está correto. O teste marca isso como `KNOWN`.
2. **Trim × velocidade invertido**: trim − deixa a lancha *mais rápida* no modelo. Na prática, um trim + moderado costuma ganhar velocidade. A atitude responde corretamente ao trim. Próximo passo: modelo de comprimento molhado (Savitsky) no lugar da saturação por ponto.
3. **Bundle grande**: 6,3 MB (1,4 MB gzip), porque importa `@babylonjs/core` inteiro. Dá para otimizar com imports por caminho na fase P5.
4. Reflexo do céu analítico (não reflete o terreno nem a lancha); sem dia/noite; sem chuva nem vento.
5. Colisão por pontos: um objeto fino entre dois pontos de contato pode atravessar o costado.
6. Combustível, danos e porão ainda não existem (o HUD só mostra o consumo estimado).

## Próximos passos (POC 1)

- [ ] Medir em celular Android/iOS real (FPS, aquecimento) e WebGPU
- [ ] Corrigir o ângulo de planeio e o efeito do trim na velocidade (limitações 1 e 2)
- [ ] Reduzir o bundle (imports por caminho) e medir o tempo de carregamento em produção
- [ ] Publicar o `dist/` (GitHub Pages) para testar por URL no celular
- [ ] Gravar vídeo do roteiro de testes para a matriz comparativa
