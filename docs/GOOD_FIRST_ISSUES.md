# Primeiras tarefas · Good first issues

🇧🇷 Tarefas pequenas para quem quer começar a contribuir. Cada uma pode virar uma issue com o rótulo
`good first issue`. Comente na issue antes de começar, para ninguém fazer a mesma coisa em paralelo.

🇺🇸 Small tasks for people who want to start contributing. Each one can become an issue labeled `good first issue`.
Comment on the issue before starting so nobody does the same work in parallel.

---

## 1. Revisar a tradução para o inglês · Review the English translation

🇧🇷 Jogue com `?lang=en`, procure frases estranhas ou sem tradução (rode `__i18nMissing()` no console) e corrija o
dicionário `pocs/babylon/src/platform/i18n.en.ts`. Ótimo para quem fala inglês e não programa muito.

🇺🇸 Play with `?lang=en`, look for awkward or untranslated phrases (run `__i18nMissing()` in the console) and fix the
dictionary in `pocs/babylon/src/platform/i18n.en.ts`. Great for English speakers who don't code much.

**Arquivos · Files:** `src/platform/i18n.en.ts`

## 2. Um barco novo na frota do pátio · A new boat in the display fleet

🇧🇷 O pátio do posto tem uma frota de exposição feita só com formas procedurais. Acrescente um modelo novo (um
veleiro pequeno, um pontoon, um caiaque na capota de um carro…).

🇺🇸 The gas station lot has a display fleet built from procedural shapes. Add a new model (a small sailboat, a
pontoon, a kayak on a car roof…).

**Arquivos · Files:** `src/sim/station.ts` (`FLEET`), `src/presentation/fleet.ts`

## 3. Mais pratos no cardápio do restaurante · More dishes on the restaurant menu

🇧🇷 O letreiro do bar & restaurante tem só alguns itens. Acrescente outros (e a tradução deles).

🇺🇸 The bar & restaurant sign has only a few items. Add more (and their translations).

**Arquivos · Files:** `src/presentation/restaurant.ts`, `src/platform/i18n.en.ts`

## 4. Um critério de teste novo · A new test criterion

🇧🇷 Escolha um comportamento que ainda não tem teste (por exemplo: a âncora da moto aquática segura com vento
moderado; o bote planeia com 2 pessoas) e escreva o critério em `tests/sim.test.ts` com uma faixa realista.

🇺🇸 Pick a behavior that has no test yet (e.g. the watercraft's anchor holds in moderate wind; the tender planes with
2 people) and write the criterion in `tests/sim.test.ts` with a realistic range.

**Arquivos · Files:** `tests/sim.test.ts`

## 5. Acessibilidade dos painéis · Panel accessibility

🇧🇷 Os botões dos painéis do Y (chaves, manetes, trim) podem ganhar `aria-label` melhores e navegação por teclado
(Tab/Enter) onde ainda não têm.

🇺🇸 The Y-panel controls (switches, levers, trim) could use better `aria-label`s and keyboard navigation (Tab/Enter)
where they don't have it yet.

**Arquivos · Files:** `src/presentation/switches.ts`, `src/presentation/levers.ts`, `src/presentation/systemsPanel.ts`

## 6. Som da água batendo no casco · Water slapping on the hull

🇧🇷 Parado com ondas, o casco poderia fazer o "chuá" da água batendo. O áudio é procedural (Web Audio) e já recebe a
telemetria das ondas e do movimento do barco.

🇺🇸 When stopped in waves, the hull could make the slapping sound of water. The audio is procedural (Web Audio) and
already receives wave and boat-motion telemetry.

**Arquivos · Files:** `src/presentation/audio.ts`

## 7. Dicas na tela de carregamento · Loading screen tips

🇧🇷 Enquanto o lago carrega, mostrar dicas que se alternam ("Segure S andando de moto aquática para frear com o iBB",
"F3 mostra a telemetria"…), em português e inglês.

🇺🇸 While the lake loads, show rotating tips ("Hold S while riding the watercraft to brake with the iBB", "F3 shows
the telemetry"…), in Portuguese and English.

**Arquivos · Files:** `index.html`, `src/main.ts`, `src/platform/i18n.en.ts`
