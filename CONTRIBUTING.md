# Como contribuir com o AQUA RUSH

🇧🇷 Português · 🇺🇸 [English](CONTRIBUTING.en.md)

Obrigado pelo interesse! O AQUA RUSH é um jogo 3D de navegação aquática para navegador e celular, e toda ajuda é
bem-vinda: código, física, som, visual, tradução, testes, ideias e relatos de bugs.

## Por onde começar

- **Jogue:** https://viniciusfantini.github.io/aquarush/ — e anote o que estranhar.
- **Tarefas para começar:** procure as issues com o rótulo
  [`good first issue`](https://github.com/viniciusfantini/aquarush/labels/good%20first%20issue). A lista inicial também
  está em [`docs/GOOD_FIRST_ISSUES.md`](docs/GOOD_FIRST_ISSUES.md).
- **Achou um bug ou tem uma ideia?** Abra uma [issue](https://github.com/viniciusfantini/aquarush/issues/new/choose)
  antes de programar algo grande — assim combinamos o caminho e ninguém perde trabalho.

## Rodando o projeto

Requisitos: Node.js 22.18+ (testado com 24) e Git.

```bash
git clone https://github.com/<seu-usuário>/aquarush.git   # o seu fork
cd aquarush/pocs/babylon
npm install
npm run dev        # http://localhost:5173 — F3 mostra a telemetria
```

Antes de abrir o Pull Request, os três têm de passar:

```bash
npm run typecheck  # sem erros
npm run test:sim   # termina com "N/N critérios OK" (KNOWN = limitação registrada)
npm run build
```

O GitHub roda os mesmos três automaticamente em todo Pull Request (aba **Checks**).

## Fluxo do Pull Request

1. Faça um **fork** do repositório e crie um branch: `git checkout -b minha-melhoria`.
2. Faça a mudança em commits pequenos e com mensagens claras (português ou inglês).
3. Rode `typecheck`, `test:sim` e `build`.
4. Abra o **Pull Request** para o branch `main` e preencha o modelo (o que mudou, como testou).
5. O mantenedor revisa, comenta e faz o merge. A publicação do site é feita pelo mantenedor.

## Regras do projeto (resumo)

O guia completo das convenções está em [`CLAUDE.md`](CLAUDE.md) (em português). O essencial:

- **Física por forças e torques**, nunca teletransporte (a única exceção é o reset no píer).
- **A água da física e a do visual vêm da mesma fonte** (`sim/water.ts`).
- **O HUD e os painéis só leem a telemetria** (`BoatTelemetry`): nada de valores decorativos.
- **`VehicleInput` é o único contrato** entre os dispositivos de entrada e a física.
- **`src/sim/**` não importa Babylon** (roda no Node para os testes).
- TypeScript "apagável": sem `enum`, `namespace` nem parameter properties; imports com a extensão `.ts`.
- **Nada é concluído sem teste**: mexeu na física (`params.ts`, `boat.ts`…), rode `test:sim` e atualize a tabela de
  resultados no README da POC. **Nunca afrouxe um critério só para o teste passar** — limitação nova vai para o
  README e, se for o caso, para o mapa `KNOWN` em `tests/sim.test.ts`.
- **Idiomas:** o código, os comentários e a interface são escritos em **pt-BR**. Todo texto novo que aparece na tela
  precisa de tradução em [`pocs/babylon/src/platform/i18n.en.ts`](pocs/babylon/src/platform/i18n.en.ts) (use `{}` nas
  partes variáveis). Para conferir, jogue com `?lang=en` e rode `__i18nMissing()` no console.
- **Sem nomes ou marcas de fabricantes** nos textos do jogo.
- Atualize o `README.md` (e o `README.en.md`) quando a mudança for visível para quem joga.

## Licença

Ao contribuir, você concorda que a sua contribuição será distribuída sob a [licença MIT](LICENSE) do projeto.

## Convivência

Este projeto segue um [Código de Conduta](CODE_OF_CONDUCT.md). Seja gentil e paciente — todo mundo aqui está
aprendendo e construindo junto.
