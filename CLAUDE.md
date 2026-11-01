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
6. Os parâmetros da lancha (`pocs/babylon/src/sim/params.ts`) são o **contrato entre as POCs**. As POCs Unity e Unreal devem usar a mesma massa, as mesmas dimensões, os 6 pontos e os mesmos coeficientes.

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
| 2026-10-31 | A esteira é um **mapa top-down** (canvas → textura) lido pelo shader da água, não uma malha por cima | Ela precisa deformar a água, distorcer o reflexo e gerar espuma de verdade. Canais: R = espuma, G − B = altura |
| 2026-10-31 | Reflexo planar com render target próprio (estilo WaterMaterial), em `med`/`high` | Água vidro exige refletir a lancha e as margens. Em `low` fica o céu analítico |
| 2026-10-31 | "Tampa" do cockpit só de profundidade (`alphaIndex` 0 < água 10) | Evita água aparecendo dentro do barco sem precisar de stencil |
| 2026-10-31 | `VehicleInput.gear` (F/N/R) + `throttle` acima da lenta; a manete com detentes fica em `platform/input.ts` | Pedido do usuário: toques trocam a marcha (F→N→R), segurar acelera, soltar volta à lenta engrenada. A sim garante a passagem por N (`shiftTime`) e a lenta engrenada (`idleThrustFraction`). `brake`/`reverse` ficaram obsoletos |
| 2026-10-31 | Som de motor **procedural** (Web Audio, sem samples), modelando um 4T de 4 cilindros: onda periódica no ciclo de 720° (fundamental = RPM/120, ordens de queima = RPM/30) | Leve, sem assets, e acompanha o RPM e a carga reais da simulação. Sem nome de marca no jogo (o usuário citou Yamaha como referência de som) |
| 2026-10-31 | O adesivo do capô diz "60", mas a física continua com 150 hp (`params.ts`) | Pendente de decisão do usuário: trocar a física para 60 hp muda a velocidade final e o planeio |
| 2026-10-31 | Esteira vive na **simulação** (`sim/wake.ts`, `WakeField`); a física usa `WaterWithWake` (altura base + marolas com idade ≥ 3 s) e o visual desenha o mesmo histórico | Pedido do usuário: atravessar a própria esteira como na vida real. Custo medido: ~0,05 ms por passo |
| 2026-10-31 | Som do motor em **AudioWorklet** (`presentation/engineWorklet.js`, JS puro importado com `?url`) | A síntese por pulsos de combustão com variação aleatória soa bem menos "eletrônica" que osciladores. Os osciladores antigos ficam como reserva. Validação offline: `node tests/engine-audio.check.mjs` (grava WAVs em `tests/out/`) |
| 2026-10-31 | Ignição: `Speedboat.toggleIgnition()`, partida só em N; tecla P (pausa → Esc) | Pedido do usuário. Segue a trava de segurança de motores reais |
| 2026-10-31 | Cavitação = f(carga × escorregamento) da hélice, com perda de até 30 % de empuxo | Aproximação documentada: aparece na arrancada e some em cruzeiro. Testada em `test:sim` |

## Ambiente do desenvolvedor

- Windows 11, Node 24.16, Git 2.55. Unity e Unreal **não** estão instalados. O `gh` CLI não está instalado.
- Repositório: https://github.com/viniciusfantini/aquarush
