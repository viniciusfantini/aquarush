# AQUA RUSH — Sistemas elétricos e de motores (referência para qualquer IA ou dev)

Este documento descreve **toda a lógica** dos sistemas elétricos, de combustível, de arrefecimento, de partida e
dos motores das 4 embarcações da POC 1 (Babylon.js, `pocs/babylon`), como estão no código na **v0.63.5**. Serve
para continuar o trabalho em outra IA/ferramenta ou portar para Unity/Unreal sem precisar redescobrir as regras.

> Fonte da verdade = o código. Se divergir, vale o código e este arquivo deve ser corrigido.
> Arquivos: `src/sim/engineSystems.ts` (combustível, temperatura, bateria, alternador, booster, GPU, barramento),
> `src/sim/turbine.ts` (turbina a gás + FADEC), `src/sim/boat.ts` (motores `EngineUnit`, partida, chaves,
> roteamento de baterias, porão), `src/sim/anchor.ts` (molinete), `src/sim/params.ts` (parâmetros = contrato entre
> as POCs). Testes: `tests/sim.test.ts` (`npm run test:sim`, hoje **578/580 + 2 KNOWN**).

---

## 1. Regras gerais (valem para tudo)

1. `src/sim/**` não importa Babylon: roda no Node (testes). A física roda a **120 Hz** em passo fixo.
2. O HUD, os painéis e o áudio **só leem a telemetria** (`BoatTelemetry`). Nada decorativo.
3. Comandos chegam por `VehicleInput` (teclado/toque) ou por métodos explícitos do `Speedboat` chamados pelos painéis
   (`setKey`, `batterySel`, `bilgeMode`, `choke`, `systems.fuelValveOpen`, `turb.setSwitch`…).
4. **Modelo elétrico em "equivalente 12 V".** Todas as contas são feitas como se o sistema fosse 12 V. Num sistema
   24 V (`nominalV: 24`, AR-10) a telemetria mostra **tensão × 2** e **corrente ÷ 2** (mesma energia). Quem precisa
   da escala 12 V (buzina, luzes, LEDs) usa `V × 12 / nominalV`.
5. **Escala de tempo da bateria:** `batteryTimeScale = 10` (carga/descarga 10× mais rápidas que o real, para o efeito
   aparecer numa sessão).
6. **Posição de chave ≠ energia.** As chaves elétricas ficam onde o piloto deixou, mesmo sem bateria; só o **LED**
   (espia) acende quando a função está energizada. Registros de combustível são mecânicos (seletores rotativos).

---

## 2. As 4 embarcações (o que muda nos sistemas)

| | AR-6 lancha (`lancha`) | AR-3 bote (`bote`) | AR-9 rápida (`rapida`) | AR-10 turbina (`turbina`) |
|---|---|---|---|---|
| Motor | popa 4T 150 hp | popa 15 hp de cana, **carburado** | 2 × V8 de centro com rabeta (300 hp cada) | turbina a gás de eixo livre ~1100 shp |
| Partida | elétrica (chave/P) | **corda** (`electricStart: false`) | elétrica, **uma chave por motor** | FADEC ou manual por chaves |
| Elétrico | 12 V, 1 banco 50 Ah | **sem bateria** (`hasBattery: false`) | 12 V, **2 bancos de 100 Ah** (um por motor) | **24 V** = 2 × 12 V em série (150 Ah eq.), seletor **OFF/BUS/BOTH** + chave **BAT** (mestre do barramento) |
| Arranque | 170 A | — | 200 A cada | starter-gerador (350 A eq.) |
| Alternador | 35 A (27 % na lenta) | — | 35 A por motor | gerador 120 A eq. (80 % já na lenta), chave **GEN** |
| Linha de combustível após o registro | 0,08 L | 0,04 L | 0,2 L | 0,3 L |
| Ajuda externa | jump start 10 Ah/200 A | — | jump start | **GPU da doca** (28 V) |
| Bomba de porão | 1500 GPH (5,5 A) | não tem | 1500 GPH | 1500 GPH |
| Molinete da âncora | 60 A | à mão (0 A) | 60 A | 70 A eq. (= 35 A reais em 24 V) |
| Temperatura | água (termostato 58 °C) | água | água por motor | **óleo da turbina** (sem corte automático) |

Largada (todos): atracada na vaga do píer, motor desligado (turbina fria), chaves em OFF, bateria 60 %, combustível
temporário (`START_FUEL` em `main.ts`: 5 L lancha/bote, 20 L AR-9, 120 L AR-10). O bote sai com o motor frio (24 °C).

---

## 3. Bateria, alternador e barramento (`EngineSystems`)

### 3.1 Bateria (chumbo-ácido)
- **Tensão em repouso** pelo estado de carga (SOC): `restV = 12,7 − 0,9·(1−soc) − 1,6·(1 − smoothstep(0, 0,15, soc))`
  → 12,7 V cheia, ~12,2 V a 50 %, ~11,9 V a 15 %, despenca abaixo disso (zerada ≈ 10,2 V).
- **Resistência interna** cresce ao descarregar: `R = (0,009 + 0,03·(1−soc)²) · (50 / Ah)` Ω (+ 3 mΩ de fiação).
  Bancos maiores têm R menor.
- **Tensão sob carga:** `supplyV(A) = fonte.v − max(0, A − alternador)·fonte.r`.
- `canStart()`: `"fuel"` se tanque < 0,05 L; `"battery"` se `supplyV(5) < 10,5 V` (nem o relé arma);
  `"overheat"` se a temperatura > `protectC`.
- **Trim elétrico** só gira se `supplyV(40) ≥ 9 V`; senão só o relé estala (`telemetry.trimRelay`).

### 3.2 Alternador
- Carrega com o motor ligado acima de 550 rpm, com o relé `genOn` fechado e alternador presente.
- Capacidade: `altMaxA · (altIdleFrac + (1−altIdleFrac)·smoothstep(750, 3000, rpm))` × nº de alternadores.
- A bateria aceita `3 + 60·(1−soc)` A além das cargas → o alternador fornece `min(capacidade, cargas + aceitação)`.
- Regulador: 13,6 V na lenta → 14,2 V acima de 3000 rpm.

### 3.3 Cargas no barramento
`drain = (luzes ? 2,5 : 0,3) + trim + aux (molinete + bomba de porão + periféricos da turbina) + arranque·starterLoad`.
O **amperímetro** é `batteryA` (+ carregando, − descarregando).

### 3.4 Barramento com até três fontes (relés)
- **Mestre do barramento** (`busOn`, só a AR-10: chave BAT **e** seletor fora de OFF) — sem ele nenhuma fonte chega
  ao barramento (`source` = 0 V, `extOnline` falso, o gerador não carrega). Nos barcos a pistão é sempre true.
- **Bateria** (`batteryOn`) — a bateria no barramento.
- **GEN** (`genOn`) — o alternador / starter-gerador.
- **GPU** (`extOnline` = GPU estável **e** relé EXT PWR fechado).

`batteryV` é a tensão **do barramento**. Com a bateria fora: o barramento fica só com a GPU ou com o gerador girando
(13,8 V eq.); sem nenhuma fonte, 0 V. Com a bateria fora ela não carrega nem descarrega.

### 3.5 Jump start (AR-6, AR-9) — tecla J
Booster de **10 Ah / 200 A** (12,9 V, 12 mΩ) em paralelo com a bateria; fornece as cargas enquanto ligado; acima de
200 A a proteção desarma (`jumperTrips`); desconecta sozinho quando o motor pega (`jumperAutoOff`); recarrega em
cruzeiro (rpm ≥ 2000 e folga de alternador ≥ 10 A) a ~10 A.

### 3.6 GPU da doca (só AR-10) — tecla J, só atracada na vaga do píer
- É um **gerador a diesel**: estados `off → starting (4,5 s) → online → stopping (4 s sem carga) → off`.
- **Dois comandos:** o **cabo** (`gpu`, J, físico) e o **relé EXT PWR** (`extPwr`). Com `autoExt` (FADEC) o relé
  fecha sozinho com a GPU estável e a turbina parada/partindo, e abre na marcha lenta (`gpuAutoOff`); no manual é a
  chave EXT PWR.
- Fonte: 28 V reais (14 V eq.), 2,5 mΩ, não descarrega; fornece as cargas e ainda carrega a bateria (até ~40 A eq.).
- Retirar o cabo corta a energia na hora; o diesel roda mais 4 s e desliga. No FADEC o relé abre junto; no **manual** a
  chave EXT PWR fica onde o piloto deixou (sem cabo ou sem MAIN: sem efeito).
- Anunciador EXT PWR: verde = no barramento; âmbar piscando = GPU disponível fora do barramento (relé aberto ou sem
  MAIN); **vermelho piscando + alarme** = `extPwrFault` (manual, chave em ON sem a GPU conectada e o barco energizado).
- Telemetria: `gpuState`, `gpuA`, `gpuKw`, `extPwr` (online), `extPwrClosed` (relé).

---

## 4. Chave geral de baterias (`Speedboat.batterySel`)

| Posição | Um banco (AR-6, AR-10*) | Dois bancos (AR-9) |
|---|---|---|
| `off` | bateria fora do barramento | nenhum banco no barramento |
| `ind` | ligada (= ON) | **cada motor no seu banco**; a casa (luzes, trim, molinete, bomba) no BB |
| `bb` | — | o banco **BB** alimenta os dois arranques, os dois alternadores e a casa; o BE fica isolado |
| `be` | — | o banco **BE** alimenta tudo; o BB fica isolado |
| `both` | — | bancos em **paralelo**: depois do passo a SOC e a tensão se igualam (ponderadas pela capacidade) |

\* Na AR-10 o seletor é outro (abaixo).

### AR-10: seletor OFF / BUS / BOTH + chave MAIN (v0.59; MAIN desde a v0.60.2)
> No painel a antiga chave BAT chama-se **MAIN**: ela liga o barramento dos sistemas eletrônicos (`Turbine.master` →
> `busOn`), não a bateria. A **espia** da MAIN acende com a chave em ON **e** o barramento com tensão de qualquer
> fonte (baterias em BOTH, GPU, gerador). Abaixo, "BAT" = MAIN. O anunciador BAT do painel = baterias no barramento.

As duas baterias de 12 V ficam **em série** (24 V); por isso não há "1"/"2" (uma sozinha daria 12 V).

| Seletor | BAT ligada | Efeito |
|---|---|---|
| `off` | — | barramento isolado (`busOn` falso): nada funciona; com a turbina rodando, o solenoide fecha e ela apaga |
| `bus` | sim | baterias **fora**; o barramento fica só com a GPU (EXT PWR) ou com o gerador (turbina rodando com GEN). Sem GPU e sem gerador: 0 V |
| `both` | sim | as duas em série no barramento (24 V) + GPU/gerador se houver |
| qualquer | **não** | BAT é o **mestre do barramento**: desligada, nada chega a ele (nem GPU, nem gerador) |

No código (`updateRpm`, ramo da turbina): `bus = tb.master && sel !== "off"`; `usys.busOn = bus`;
`usys.batteryOn = bus && sel !== "bus"`; `usys.genOn = tb.generator && !tb.starter`. A largada é em `both`.
FADEC (`toggleIgnition`): sem `bus`, ou em `bus` sem a GPU estável → `"noPower"`.

- A temperatura e o combustível de cada motor continuam por motor; só a parte elétrica muda de rota.
- `bankFor(i)` = banco que alimenta o motor `i` (em `bb` → 0, em `be` → 1, senão o próprio). A partida e a tensão do
  arranque usam esse banco (`uelec`).
- **Partida pelo P** confere `bankFor(i).canStart()` de cada motor; recusa "bateria fraca" só se **todos** falharem
  (correção da v0.58: antes olhava sempre o BB, que em BE fica isolado com 0 V).
- Um banco isolado mostra no relógio a tensão da própria bateria (`restV`).
- `telemetry.houseV`: tensão real do barramento da casa (em BE é o banco de boreste) — luzes, buzina e LEDs.

### Chave geral em OFF com o motor ligado
- **Pistão (AR-6, AR-9):** o motor **continua ligado** — o alternador alimenta a ignição pelo barramento
  (13,6–14,2 V). A bateria para de carregar; o painel avisa do risco de queimar o regulador (load dump). Com o motor
  parado e a chave em OFF: sem partida, sem bomba de porão, sem luzes.
- **Bote:** magneto, sem bateria — nada muda.
- **AR-10:** seletor em **BUS** com o **GERADOR** ligado: a turbina segue (o gerador segura o barramento). Sem gerador
  e sem GPU o barramento cai; o **solenoide de corte de combustível** (normalmente fechado) perde a tensão e, depois
  de **0,3 s** sem barramento (`Turbine.unpoweredT`), fecha → a chama apaga. **BAT desligada** (mestre) ou seletor em
  **OFF**: o barramento cai na hora, mesmo com o gerador → apaga.

---

## 5. Combustível (`EngineSystems`)

- **Registro do tanque** (`fuelValveOpen`, seletor rotativo FECHADO/ABERTO, comum aos dois motores da AR-9).
- `lineL` = combustível na linha/filtro/cuba depois do registro. Fechado: o motor gasta a linha e morre
  (`stall = "fuel"`); aberto: a linha reenche a 0,05 L/s.
- `fuelFeed` = chega combustível (registro aberto com tanque > 0,005 L, ou linha > 0,0005 L). Todo lugar que
  decide "tem combustível" usa `fuelFeed`.
- **Engasgo:** perto do fim do tanque (0,1 % do tanque) ou da linha (20 %) o motor engasga em pulsos (`starving`).
- Sem combustível a partida é **permitida** (o arranque gira / a corda é puxada), mas o motor não pega
  (`startFail = "fuel"`).

---

## 6. Arrefecimento (motores a pistão)

- Com o motor ligado e a entrada d'água submersa: alvo = termostato + 6·carga (τ 90 s frio / 25 s regulando).
- Sem água (fora d'água, rebocado): alvo 135 °C, τ 40 s. Desligado: esfria para o ambiente (τ 420 s).
- `warnC` 85 °C (alarme) → `protectC` 90 °C (modo proteção, rotação limitada a `protectRpm` 2000; histerese até
  `warnC − 5`) → `shutdownC` 115 °C (desliga, `stall = "overheat"`).
- AR-9: um arrefecimento por motor (`systems2`); `coolantC` = o mais quente.

---

## 7. Motores a pistão: `EngineUnit` e partida

Cada motor é um `EngineUnit` (estado por motor: `engine` off/cranking/running, `rpm`, `gear`, acelerador, cavitação,
hélice, **`key`**). Os acessores do `Speedboat` apontam para o motor corrente dentro de `eachUnit`; fora do laço
o getter `engine` agrega (algum ligado = "running") e os setters valem para todos.

### 7.1 Chave de ignição por motor (v0.58) — `Speedboat.setKey(i, "off" | "on" | "start")`
- **OFF:** ignição desligada; se o motor estiver ligado/girando, para.
- **ON:** ignição ligada e **autoteste** (`testT` = 1,1 s, alarme apitando) **se** o banco do motor tiver
  `supplyV(2) > 9 V`; sem tensão, nada apita. **Energizar depois:** com a chave já em ON e o motor parado, quando o
  banco ganha tensão (chave geral ligada) o autoteste apita (`EngineUnit.keyLive` guarda o estado do passo anterior).
- **START** (momentâneo, com mola): só em N; gira o arranque **enquanto segurada** (`manualCrank`, sem o limite de
  4 s). Ao soltar o painel manda `"on"`: se não pegou, o arranque para e registra `startFail`.
- Engatado → `"needNeutral"`; sem piloto no posto → `"noPilot"`; avariado (≥ 95 %) → `"broken"`.
- AR-9: duas chaves (IGNIÇÃO BB / BE). Com a chave os arranques podem girar juntos (decisão do piloto; a tensão cai).

### 7.2 Partida pelo P (`toggleIgnition`)
- Ligado → desliga e põe as chaves em OFF.
- Desligado → (N obrigatório) confere os bancos, põe as chaves em ON, autoteste de 1,1 s e então cada motor entra no
  arranque; com dois motores **um arranque de cada vez** (`waitsToCrank`: o segundo espera 1,2 s e o primeiro
  terminar). Limite de 4 s por tentativa.

### 7.3 Arranque elétrico (física)
- Rotação do arranque pela tensão nos bornes: `260 · clamp((V − 7,5) / 3,1, 0, 1,05)` rpm (bateria boa ≈ 250 rpm).
- Abaixo de ~7,5 V só o solenoide estala (o áudio faz o "clunk").
- Pega quando as voltas de compressão (`crankRevs`) passam de `crankNeed` (3–5) **e** há `fuelFeed`.
- Falhas: `startFail` = `"dead"` (rpm < 40), `"weak"` (girou mas não pegou), `"fuel"` (girou sem combustível).

### 7.4 Corda (bote)
- Um puxão gira ~450 rpm por 0,5 s. Chance de pegar: carburado frio 15 % sem afogador / 80 % com; quente 85 % sem /
  30 % com (sem combustível nunca). Falhou → `startFail = "pull"`.
- **Afogador** (`choke`, mecânico): frio, sobe a lenta (+250 rpm); **quente (> 45 °C) com o afogador puxado**, a
  mistura fica rica (rotação × 0,72) e o motor **afoga em ~15 s** (`stall = "flooded"`).
- No painel: manete da corda (= P) e botão STOP.

### 7.5 Neutro, limitador, câmbio e proteção
- Acelerar em N (`VehicleInput.neutralThrottle`): teclado N + W, ou pelo painel — botão **N** da manete de topo
  (AR-6/AR-9: só arma em N, desarma ao voltar a N), punho da cana em N (bote), potência em N (AR-10).
  Sem limite próprio em N (removido na v0.60.4; vale o corte de giro `revLimitRpm`). Com dois motores cada manete acelera o seu (o `engineCmd` leva o acelerador).
- **Câmbio hidráulico** (`params.hydraulicShift`, só a AR-10): sem o motor rodando não há pressão nas embreagens — a
  marcha não engata e, se estava engatada, volta para N. Câmbio mecânico (popa, rabeta): engata até parado. Limitador de giro em pulsos acima de `revLimitRpm`.
- Passagem obrigatória por N ao trocar de marcha (`shiftTime`); lenta engrenada dá um empuxo mínimo.

---

## 8. Turbina a gás (AR-10, `Turbine`)

### 8.1 Parâmetros principais
idle N1 62 %, max N1 101 %, starter sozinho até 24 % N1, ignição + combustível a **12 %**, starter/ignição desligam a
**45 %**, EGT idle 480 °C, max 640 °C, **limite de partida 780 °C**, redline 700 °C, N2 100 % = 6000 rpm (redução 2,4 →
hélice 2500 rpm), 85–470 L/h, spool-down τ 9 s, óleo: alarme 110 °C, dano acima de 120 °C.

### 8.2 A física lê só as CHAVES
Chaves: `master` (BAT), `boostPump`, `ignition`, `starter`, `fuelValve` (condição CORTE/LENTA), `generator` (GEN);
mais o EXT PWR da GPU no `EngineSystems`.
- **Tudo é periférico do barramento:** funciona se houver tensão (`volts > 6`) — bateria, GPU ou gerador.
  A posição da chave fica (telemetria `starterSw`/`ignitionSw`); o funcionamento é chave **e** energia
  (`starter`/`ignition` na telemetria, `powered`).
- Periféricos consomem: bomba ~16 A eq., velas ~6 A, solenoide 1,6 A, FADEC/instrumentos 3 A.
- Combustível chega à câmara: válvula aberta **e** barramento há < 0,3 s **e** tanque **e** (bomba ligada ou N1 > 45 %).
- **Acende** com combustível + ignição + N1 ≥ 9 % depois de ~1,1 s. Acesa: acelera com o starter; sem starter só se
  sustenta acima de **40 % N1** (abaixo: rollback, esquenta). Chega à lenta (≥ 61,5 %) → `running`.
- Starter-gerador (sem embreagem): no **FADEC** o controle de partida corta o starter (a 45 %; "speed switch" de reserva
  a 60 %). No **MANUAL ninguém corta** — é o piloto: esquecido ligado acima de 60 % N1 gera o evento
  `starterOverspeed` (aviso), aquece **4× mais rápido** e o térmico desarma. Uso contínuo > 40 s (equivalentes) →
  superaquece e trava 60 s (`starterLockT`). O gerador só gera com o starter desligado.
- N2 (turbina livre): torque disponível ∝ gás·(2 − N2), carga da hélice ∝ carga·N2² (lei da hélice).

### 8.3 FADEC (padrão) — camada que aciona as mesmas chaves (`fadecStep`)
1. `start()`: bomba ON, starter ON (não liga a BAT: ela é do piloto; sem BAT e sem GPU → `"noPower"`).
2. N1 ≥ 12 % → ignição + combustível. Não chegou em 20 s → aborta (`hungStart`).
3. Não acendeu em 10 s → aborta (`noLightOff`).
4. Acesa e N1 ≥ 45 % → starter e ignição OFF. EGT > 780 °C → aborta (`hotStart`).
5. Marcha lenta → GERADOR ON; com a GPU, abre o EXT PWR.
O piloto pode mexer na BAT mesmo no FADEC (`setSwitch("master")`).

### 8.4 Manual — defeitos reais (ninguém protege)
- **Partida molhada:** combustível sem ignição/N1 baixo acumula (`pooledL`) → labareda e pico de EGT ao acender.
- **Combustível cedo** (antes de 12 % N1, `earlyL`) → partida quente.
- **Rollback / pendurada:** desligar o starter abaixo de 40 % N1.
- **Sobretemperatura:** EGT > 780 °C desgasta (`wear`); ≥ 95 % → turbina **travada** (`seizedOn`, vira avaria).
- Starter superaquecido (40 s; acima de 60 % N1 conta 4×) — sem corte automático no manual.

### 8.5 Óleo e água de resfriamento
- `oilC`: calor ∝ N1 e potência; resfriamento pelo trocador de calor (água do mar) ∝ vazão acima de 70 °C + perda
  para o ar. **Sem corte automático:** acima de 110 °C alarme (luz + som); acima de 120 °C desgaste → avaria → trava.
- Bomba de água do mar **mecânica**: vazão ∝ N1 (3 L/s a 100 %), só com a tomada submersa (`coolingLps`), sai como
  jato no espelho.

### 8.6 Painel, START/CORTE e checklist (v0.62)
O painel de partida mostra sempre as 7 chaves. **START** (redondo verde, legenda AUTO-START, em cima do STOP; = P) = partida automática: se estava no
manual, `setFadec(true)` (sem ligar a MAIN) e o FADEC faz a sequência. **STOP** (redondo vermelho; "CORTE" nas versões anteriores): no FADEC
corta/aborta; no manual fecha o combustível e desliga starter e ignição. **Acionar qualquer chave (menos a MAIN) com
o FADEC no comando passa para o MANUAL** (`setFadec(false)`; sem proteção). O **CHECKLIST** (janela `ChecklistPanel`)
lista os passos FADEC e manual, marcados pela telemetria.

### 8.7 Ignição/P na AR-10
P = START/CORTE do FADEC (de novo aborta/corta); parado no manual, o P devolve ao FADEC e dá a partida. N1 > 8 % ainda
girando → `"busy"`.

---

## 9. Porão, bomba e molinete

- **Bomba de porão** (`bilgeMode`, alavanca de 3 posições ON/OFF/AUTO): ON liga mesmo seca; AUTO pela boia (> 6 L);
  OFF não bombeia. Só gira com tensão; corrente 5,5 A × (0,7 + 0,3·molhada). Vazão
  `Q = Qmax·(1 − H/shutoffHead)·f(V)`; jato `v = Q / área da saída`. Alarme de porão com a bomba jogando água ou
  água > 40 L. Áudio: zumbido do motor DC sempre que gira (mais agudo seca) + chiado do jato.
- **Molinete** (`anchor.ts`): corrente `motorA` (subindo × (1 + carga); descendo × 0,45); exige `supplyV(motorA) ≥ 9 V`,
  senão só o relé. AR-10: 70 A eq. (35 A reais).

---

## 10. Painéis (tecla Y) e chaves (`presentation/`)

- `systemsPanel.ts` (AR-6, AR-3, AR-9): seção **PARTIDA** (chaves OFF·ON·START por motor ou corda + STOP) e
  **SISTEMAS** (baterias rotativa, registro rotativo, afogador puxador, bomba 3 posições, luzes).
- `turbinePanel.ts` (AR-10, v0.62.7 — 700 px, em faixas): 8 relógios analógicos com faixas (N1, EGT, N2, torque,
  óleo psi, óleo °C, barramento, GPU A); anunciadores (BAT, EXT PWR, GEN, STARTER, IGNIÇÃO, CHAMA, EGT ALTA, ÓLEO
  QUENTE) em 4 colunas; a **botoeira de partida** (7 chaves numeradas: MAIN, EXT PWR, BOMBA COMB., STARTER com capa,
  IGNIÇÃO, COMBUSTÍVEL rotativo CORTE/LENTA, GERADOR) sempre à vista; **sistemas** (seletor de baterias OFF/BUS/BOTH,
  tanque rotativo, bomba de porão) com a seção **START (em cima, legenda AUTO-START) / STOP (embaixo)** ao lado;
  **manetes** (potência em T, marcha F-N-R hidráulica, buzina, trim) numa faixa embaixo; display de avisos no pé.
  No título: indicador FADEC/MANUAL (não é seletor) e o botão **CHECKLIST** (janela `ChecklistPanel`). A **GPU da
  doca não fica no Y**: é comando externo (J, na barra de atalhos à esquerda do HUD; estado no visor do carrinho).
  O aviso "SEM PRESSÃO" do câmbio hidráulico (manete engatada com a turbina parada) vai para o display de avisos.
- `switches.ts`: `toggle` (LED = `lit`, posição = `on`), `tri` (`armed` âmbar / `run` verde), `rotary`, `ignKey`
  + `bindKeySpring` (START com mola), `pull`, `rope`.
- **Avisos** de sistemas/motor (`sysToast` em main.ts): com o painel do Y aberto vão para o display do pé dele
  (`flash`, ~6 s); fechado, aviso normal do HUD.
- **Trim no painel** (`LeverControls.setTrim/updateTrim`): power trim (AR-6 TRIM/TILT, AR-9 rabetas juntas, AR-10
  transmissão de superfície) = botão basculante momentâneo (→ `input.touchTrim`, igual a E/Q) + barra (trim verde,
  tilt âmbar); bote = pino de regulagem (furos 1..N, T = tilt travado) com ▲▼.
- **Buzina** no painel (`input.panelHorn`, = B); no bote é **apito** (`audio.setHorn("apito")`, sem bateria).
- `dragPanel.ts`: janelas arrastáveis (posição em `localStorage`; o painel inteiro fica dentro da tela).
- Display de avisos no pé dos painéis (`setRd`, `.msg-rd`): caixa fixa, texto rola se não couber; tema por barco
  (`data-disp`): `lcd` (AR-6), `vfd` (AR-9), `grey` (bote), `glass` (AR-10). As leituras embaixo das chaves são texto simples. Bote: lanterna de mão (`lantern`), não chave.
- `levers.ts` (`LeverControls`, v0.59–0.60; `LeverCmd.neutral` = acelerar em neutro): manetes por tipo — `binnacle` (AR-6: manete única de topo, p ∈ [−1, 1], N em
  |p| < 0,12, lenta engrenada até 0,2, acelerador = (|p| − 0,2)/0,8), `twin` (AR-9: duas, independentes), `tiller`
  (bote: punho giratório + câmbio F-N-R), `turbine` (AR-10: potência em T + marcha). O painel é um **dispositivo de
  entrada**: `InputManager.setPanelLever(i, cmd, motores)` → `touchLever` (um motor) ou `panelLevers` → `engineCmd`
  (dois). Teclado/gamepad (W/S, N) retomam e limpam as manetes do painel. Trocar a marcha no câmbio separado volta o
  acelerador para a lenta (a sim só engata com `throttleActual < 0,12`).

---

- **Alertas do HUD** (`hud.ts`): reserva de combustível = aviso **laranja fixo** "RESERVA · x L" (mostrador normal);
  só **pisca** quando acaba ("SEM COMBUSTÍVEL", mostrador vermelho). Avarias de casco/motor: laranja fixo até 80 %,
  **piscando rápido** (vermelho/laranja) acima de 80 % (classes `.chip.warn.steady` / `.chip.warn.crit`).

---

## 10b. Abandonar o barco e pessoas na água (`boat.ts`, v0.63)

- **Barra de espaço** → `Speedboat.abandonShip()`: 1º toque, só os **passageiros** pulam (o piloto segue no comando);
  2º toque (ou sem passageiros), o **piloto** pula e o **corta-circuito** (cordão preso a ele) desliga o motor
  (`stall = "lanyard"`; na turbina = corte de combustível). Na **AR-10 virada** (habitáculo fechado, o piloto fica
  preso no cinto ao virar) é assim que ele sai da cabine.
- Na água (`updateSwimmers`): colete (centro ~5 cm abaixo da superfície), arrasto, correnteza; depois de ~1 s nadam
  até o seu lugar em volta do casco a até **~0,55 m/s**. Só quem está junto do casco (< 0,6 m do lugar) acompanha o
  barco (segura o cabo de mão); longe, a pessoa fica parada na água e avança só o que nada.
- **Volta a bordo** sozinha (`occupants`, contador `reboarded`) a ~0,45 m do lugar, depois de 2,5 s na água, com o
  barco **de pé, não afundado e a até 3 km/h**. Barco virado ou afundado: ninguém volta (R recomeça).

## 11. Telemetria relevante (`BoatTelemetry`)

`engine`, `engines[]`, `keys[]`, `rpm`, `rpms[]`, `startFail`, `stall`, `buzzer`, `starterRpm`, `pullStart`,
`batteryV` (barramento, real), `batteryA`, `batterySoc`, `batteryVs[]`/`batterySocs[]`/`batteryAs[]` (por banco),
`houseV`, `nominalV`, `batterySel`, `busBattery`, `busGen`, `jumper`, `jumpCharge`, `gpu`, `gpuState`, `gpuA`,
`gpuKw`, `extPwr`, `extPwrClosed`, `fuelL`, `fuelValveOpen`, `fuelLineFrac`, `choke`, `coolantC`, `coolants[]`,
`overheatWarn`, `protectMode`, `chargeWarn`, `bilgeL`, `bilgeMode`, `bilgePump`, `bilgeFlowLps`, `bilgeAlarm`,
`windlassA`, `coolingLps`, `extPwrFault`, `keys[]`, `houseV`, `swimmers`, `capsized`, `hullDamage`,
`engineDamage`, `turbine { n1, n2, egt, torque, oilPsi, oilC, oilHot, oilRed, phase, lit, powered,
starter, ignition, starterSw, ignitionSw, master, boostPump, fuelValve, generator, fadec, pooledL, wear, seized,
starterLock }`.

---

## 12. Critérios de teste ligados a estes sistemas (`tests/sim.test.ts`)

Grupos "sistemas", "bateria", "amperímetro", "neutro", "porão", "rápida", "turbina". Exemplos (v0.58):
- AR-9 BE zerado: IND 1 motor, BB 2, BE 0, AMBAS iguala e 2, OFF 0; BB zerado em BE: 2.
- Chave: ON apita e não gira; START segurada pega em ~1,2 s; soltar → ON e ligado; OFF para; engatado recusa;
  bateria zerada 8 s não pega; AR-9 só BB → só BB.
- Chave geral OFF com os motores ligados (pistão): seguem. Chave em ON sem bateria: silêncio; ligou a geral: apita.
- AR-10: BUS com GEN → segue; BUS sem GEN → apaga em ~0,4 s; BAT (mestre) off → apaga; FADEC em OFF / BUS sem GPU
  recusam; BUS + GPU parte com a bateria fora; manual: starter não desacopla sozinho e desarma esquecido ligado.
- Registro fechado: AR-6 morre em ~96 s; afogador frio 7 % × 85 %; quente afoga em ~15 s.
- Abandonar: 1º espaço só o passageiro, 2º o piloto (corta-circuito); afastamento ~3,3 m; voltam a bordo em ~5 s;
  pulando a 65 km/h, 6 s depois só a velocidade de nado e a volta em ~3 min; AR-10 virada: o piloto sai e fica na água.
- AR-10: câmbio hidráulico (parada não engata; cortada volta a N); EXT PWR sem MAIN sem efeito; falha do EXT PWR sem GPU.
- Turbina: sequência FADEC, pico de EGT 550–760 °C a 60 % de bateria, marcha lenta em 12–35 s, 24 V mínimo no
  arranque 18–25 V, GPU, partida quente a 43 %, partida manual errada (molhada, cedo, rollback), óleo, molinete −16 A.

Regra do projeto: **nunca afrouxe um critério só para passar**; limitação nova vai para o mapa `KNOWN` e o README da POC.
