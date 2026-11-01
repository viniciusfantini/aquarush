# CLAUDE.md: guia para agentes de IA no AQUA RUSH

## Contexto

- O jogo é de navegação aquática 3D para **mobile e navegador**. As premissas estão em `docs/AQUA_RUSH_GDD_COMPLETO_v2.docx`. Para ler e buscar, use `docs/GDD_texto_extraido.txt`.
- **Fase atual: POC comparativa** (GDD §10). A mesma fatia jogável será feita em três tecnologias, da mais simples para a mais complexa: Babylon.js (feita), Unity 6 + URP e Unreal. **Não transformar POC em jogo completo.** A economia, o multiplayer e o mapa completo estão fora do escopo (GDD A.14).
- O usuário escreve em português. Docs, comentários e UI são em **pt-BR**.

## Regras do GDD que valem para todo código

1. **Física por forças e torques**, nunca `Translate` ou teleporte (o reset no píer é a única exceção).
2. **A água da física e a do visual vêm da mesma fonte.** As ondas de Gerstner são definidas uma vez (`sim/water.ts`) e o shader recebe os mesmos parâmetros.
3. **O HUD lê só a telemetria real** (`BoatTelemetry`). Nada de valores decorativos.
4. **`VehicleInput` é o único contrato** entre dispositivos e controladores. Os controladores não sabem a origem do comando.
5. **Nada é marcado como concluído sem um teste executado e o resultado registrado** (README da POC).
6. Os parâmetros dos barcos (`pocs/babylon/src/sim/params.ts`: `SPEEDBOAT` e `DINGHY`) são o **contrato entre as POCs**. As POCs Unity e Unreal devem usar a mesma massa, as mesmas dimensões, os 6 pontos e os mesmos coeficientes.

## POC 1: Babylon (`pocs/babylon`)

- `src/sim/**` **não pode importar Babylon** (precisa rodar no Node para os testes).
- A esteira, o spray e o HUD só leem a telemetria (`BoatTelemetry`): velocidade na água, acelerador, `cavitation`, `ventilation`, `propRpm`.
- No mapa de esteira, a DynamicTexture inverte o canvas no upload: **+Z do mundo = para baixo no canvas** (`Y(z) = N/2 + (z - oz) * ppm` em `wakeMap.ts`). Inverter isso faz a esteira sair à frente da proa.
- Uma textura dinâmica nova precisa de `update()` antes do 1º quadro, senão o material fica "not ready" e a cena não inicia (aconteceu com o mapa de esteira). Se a cena não carregar, o `main.ts` loga após 4 s o que está pendente.
- Convenção de eixos: X direita, Y cima, Z proa. Quaternions de Hamilton, iguais aos da Babylon (verificado no navegador).
- A física roda a 120 Hz em passo fixo (`core/config.ts`). O render interpola.
- Só use sintaxe TS "apagável" (`erasableSyntaxOnly`): sem `enum`, `namespace` nem parameter properties. Os imports levam a extensão `.ts`.

### Como validar uma mudança

```bash
cd pocs/babylon
npm run typecheck      # tsc 7, deve sair sem erros
npm run test:sim       # tem de terminar com "N/N critérios OK" (KNOWN = limitação registrada)
npm run build
npm run dev            # abrir http://localhost:5173, F3 mostra a telemetria; window.__aqua expõe boat/water/scene
```

- Ao mexer em `params.ts` ou `boat.ts`, **rode `test:sim` e atualize a tabela de resultados** em `pocs/babylon/README.md`.
- Para calibrar, use `node tests/debug-trim.ts` (forças por ponto em regime permanente) e `node tests/debug-turn.ts <acelerador> <t_curva>`.
- Uma limitação nova vai para o README da POC e, se for o caso, para o mapa `KNOWN` em `tests/sim.test.ts`. Nunca afrouxe um critério só para passar.

## Decisões registradas

| Data | Decisão | Motivo |
|---|---|---|
| 2026-10-31 | A POC 1 é Babylon.js, com física própria em vez de Havok | É a mais simples (sem instalar engine, roda por URL). Uma física própria e testável no Node controla flutuação, planeio e trim do jeito que o GDD exige e serve de referência para Unity e Unreal |
| 2026-10-31 | 6 pontos de flutuação + sustentação de planeio por ponto + sistema de ondas do casco (hump) | O GDD pede 6 pontos, e o planeio precisa surgir da física, não de animação |
| 2026-10-31 | Monorepo com `pocs/<tecnologia>` | O GDD §15 pede pastas claramente isoladas |
| 2026-10-31 | Qualidade padrão `low` em dispositivos touch, `med` no desktop | Meta de 30 FPS em celular intermediário |
| 2026-11-01 | Resolução = densidade real da tela até `maxPixelRatio` do perfil + resolução dinâmica por FPS; iPhone/iPad começam em `med` | O usuário achou o iPhone borrado: o escalonamento antigo renderizava a 1/4,5 da resolução nativa |
| 2026-11-01 | Rampa no `groundHeight` (`RAMP`, `rampY` em `sim/world.ts`) e carretinha em `sim/trailer.ts`: berço = `SupportSurface` (só apoia por cima, V centraliza), postes/batente = `BoxCollider`, cinta do guincho = mola só de tração; `world.surfaces/boxes` trocam com o barco ativo. Contatos com rigidez ∝ massa | Pedido do usuário: rampa de concreto, carretinha por barco (bote + carro, lancha + caminhonete) para simular tirar o barco da água. Calibração: `node tests/debug-trailer.ts [lancha|bote] [acel] [desvio]` |
| 2026-11-01 | Emborcamento na **simulação** (`Speedboat.swimmers`, `capsized`): pessoas na água são pontos com empuxo do colete, arrasto e correnteza; o visual só lê (`Pilot.float` / `board` em `pilot.ts`) | Pedido do usuário: se o barco virar, as pessoas caem e boiam de colete. Fica testável no Node (`tests/debug-capsize.ts`). Na v0.15 as pessoas nadam até um lugar em volta do barco (escolhido pelo lado em que estão) e, sem ocupante no posto `helm`, `Speedboat.step` ignora os comandos |
| 2026-11-01 | Menu = cena real: as duas embarcações são montadas no início (`makeVessel` em `main.ts`), só a ativa aparece e roda a física; `activate()` troca sem recarregar | Pedido do usuário: escolher o barco já no ambiente real, com prévia |
| 2026-11-01 | **Dois barcos, uma física**: `Speedboat` recebe `SpeedboatParams` (`VESSELS.lancha` / `VESSELS.bote`). O bote só muda parâmetros e modos (`steering: "tiller"`, `trimMode: "manual"`, `electricStart: false`); o visual do bote fica em `presentation/dinghyMesh.ts` e expõe o mesmo `BoatVisual` + `controls` (no lugar do `helm.ts`) | Pedido do usuário: bote de apoio de até 3 pessoas com motor de cana, sem trim elétrico, trim em 3 furos + tilt só parado, escolha do barco na abertura (`?barco=` na URL) |
| 2026-11-01 | Bateria com resistência interna dependente da carga + rotação do arranque pela tensão + autoteste com apito; carga/descarga com `batteryTimeScale` = 10 | Pedido do usuário: muitas partidas ou tilt com o motor desligado deixam a partida fraca, e o motor ligado recarrega. Em tempo real o efeito levaria horas |
| 2026-11-01 | Rotação do motor: **tilt por fora, direção por dentro** (`qTilt × qSteer` no visual, `driveRot` na física). Não usar `rotation.x/y` da Babylon no motor (ela aplica o yaw por fora) | Com o motor recolhido, ele girava em torno da vertical do barco e varria o pé para os lados |
| 2026-10-31 | A esteira é um **mapa top-down** (canvas → textura) lido pelo shader da água, não uma malha por cima | Ela precisa deformar a água, distorcer o reflexo e gerar espuma de verdade. Canais: R = espuma, G − B = altura |
| 2026-10-31 | Reflexo planar com render target próprio (estilo WaterMaterial), em `med`/`high` | Água vidro exige refletir a lancha e as margens. Em `low` fica o céu analítico |
| 2026-10-31 | "Tampa" do cockpit só de profundidade (`alphaIndex` 0 < água 10) | Evita água aparecendo dentro do barco sem precisar de stencil |
| 2026-10-31 | `VehicleInput.gear` (F/N/R) + `throttle` acima da lenta; a manete com detentes fica em `platform/input.ts` | Pedido do usuário: toques trocam a marcha (F→N→R), segurar acelera, soltar volta à lenta engrenada. A sim garante a passagem por N (`shiftTime`) e a lenta engrenada (`idleThrustFraction`). `brake`/`reverse` ficaram obsoletos |
| 2026-10-31 | Som de motor **procedural** (Web Audio, sem samples), modelando um 4T de 4 cilindros: onda periódica no ciclo de 720° (fundamental = RPM/120, ordens de queima = RPM/30) | Leve, sem assets, e acompanha o RPM e a carga reais da simulação. Sem nome de marca no jogo (o usuário citou Yamaha como referência de som) |
| 2026-10-31 | Adesivo do capô = `SPEEDBOAT.enginePowerHp` (150) | Decisão do usuário: o adesivo segue a potência real da física |
| 2026-10-31 | Trim e tilt num só comando: faixa de trim (hélice sempre na água) + tilt até 60°, bloqueado pela **carga no pé** (empuxo > `tiltMaxThrust`, rpm > `tiltMaxRpm` ou velocidade > `tiltMaxSpeed`), não pela marcha | Igual ao power trim real: engatado em baixa rotação recolhe (água rasa). A hélice e a entrada d'água giram em torno de `drivePivot` |
| 2026-10-31 | Esteira vive na **simulação** (`sim/wake.ts`, `WakeField`); a física usa `WaterWithWake` (altura base + marolas com idade ≥ 3 s) e o visual desenha o mesmo histórico | Pedido do usuário: atravessar a própria esteira como na vida real. Custo medido: ~0,05 ms por passo |
| 2026-10-31 | Som do motor em **AudioWorklet** (`presentation/engineWorklet.js`, JS puro importado com `?url`) | A síntese por pulsos de combustão com variação aleatória soa bem menos "eletrônica" que osciladores. Os osciladores antigos ficam como reserva. Validação offline: `node tests/engine-audio.check.mjs` (grava WAVs em `tests/out/`) |
| 2026-10-31 | Ignição: `Speedboat.toggleIgnition()`, partida só em N; tecla P (pausa → Esc) | Pedido do usuário. Segue a trava de segurança de motores reais |
| 2026-10-31 | Agarre lateral (`keelLift`) aplicado perto do CG + `yawDamping` alto, em vez de só arrasto lateral por ponto | O arrasto lateral distribuído criava efeito cata-vento: ao soltar o volante a lancha voltava para o lado oposto. Teste de regressão: "4 curva soltar" |
| 2026-10-31 | Em N a hélice gira solta (arrastada pela água, inércia de 0,6 s) | Como num motor real com o câmbio desacoplado |
| 2026-10-31 | Instrumentos vêm de `sim/engineSystems.ts` (combustível, temperatura, bateria, horímetro); painel 3D em `presentation/helm.ts`, piloto com IK em `presentation/pilot.ts` | Regra do GDD: HUD e painel só leem telemetria real. O horímetro persiste em `localStorage` (`aquarush.engineHours`); R reposiciona e abastece |
| 2026-10-31 | `params.mass` = massa **seca**; gasolina e ocupantes são cargas pontuais em `Speedboat.occupants` / `systems.fuelL`, com peso aplicado na posição e inércia por Steiner | Pedido do usuário: a física respeita peso e posição. O jogo começa com 3 L (pedido do usuário, v0.12; os testes usam o tanque cheio por padrão) |
| 2026-10-31 | HUD com relógios SVG (`RoundGauge` em `hud.ts`): ponteiro e leitura digital na faixa livre de baixo do mostrador | Pedido do usuário: relógios redondos com indicação digital, sem sobreposição |
| 2026-10-31 | Cavitação = f(carga × escorregamento) da hélice, com perda de até 30 % de empuxo | Aproximação documentada: aparece na arrancada e some em cruzeiro. Testada em `test:sim` |

## Ambiente do desenvolvedor

- Windows 11, Node 24.16, Git 2.55. Unity e Unreal **não** estão instalados. O `gh` CLI não está instalado.
- Repositório: https://github.com/viniciusfantini/aquarush
- **Online (GitHub Pages, público):** https://viniciusfantini.github.io/aquarush/. Publicar: `cd pocs/babylon && npm run deploy` (roda typecheck e testes; se algo falhar, não publica; empurra `dist/` para a branch `gh-pages`). **Só publique quando o usuário pedir** (ele testa localmente com `npm run dev`); commitar e atualizar o README continua valendo a cada versão.
