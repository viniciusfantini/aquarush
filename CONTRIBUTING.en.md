# Contributing to AQUA RUSH

🇧🇷 [Português](CONTRIBUTING.md) · 🇺🇸 English

Thanks for your interest! AQUA RUSH is a 3D boating game for web browsers and phones, and every kind of help is
welcome: code, physics, sound, visuals, translation, tests, ideas and bug reports.

## Where to start

- **Play it:** https://viniciusfantini.github.io/aquarush/?lang=en — and note anything that feels off.
- **Starter tasks:** look for issues labeled
  [`good first issue`](https://github.com/viniciusfantini/aquarush/labels/good%20first%20issue). The initial list is also
  in [`docs/GOOD_FIRST_ISSUES.md`](docs/GOOD_FIRST_ISSUES.md).
- **Found a bug or have an idea?** Open an [issue](https://github.com/viniciusfantini/aquarush/issues/new/choose)
  before coding something big — that way we agree on the approach and nobody wastes work.

## Running the project

Requirements: Node.js 22.18+ (tested with 24) and Git.

```bash
git clone https://github.com/<your-user>/aquarush.git   # your fork
cd aquarush/pocs/babylon
npm install
npm run dev        # http://localhost:5173 — F3 shows the telemetry
```

Before opening a Pull Request, these three must pass:

```bash
npm run typecheck  # no errors
npm run test:sim   # ends with "N/N critérios OK" (KNOWN = documented limitation)
npm run build
```

GitHub runs the same three automatically on every Pull Request (**Checks** tab).

## Pull Request workflow

1. **Fork** the repository and create a branch: `git checkout -b my-improvement`.
2. Make your change in small commits with clear messages (English or Portuguese).
3. Run `typecheck`, `test:sim` and `build`.
4. Open a **Pull Request** against `main` and fill in the template (what changed, how you tested it).
5. The maintainer reviews, comments and merges. Publishing the site is done by the maintainer.

## Project rules (summary)

The full conventions guide is [`CLAUDE.md`](CLAUDE.md) (in Portuguese). The essentials:

- **Physics through forces and torques**, never teleporting (the only exception is the pier reset).
- **Physics water and visual water come from the same source** (`sim/water.ts`).
- **The HUD and panels only read telemetry** (`BoatTelemetry`): no decorative values.
- **`VehicleInput` is the only contract** between input devices and the physics.
- **`src/sim/**` must not import Babylon** (it runs in Node for the tests).
- "Erasable" TypeScript only: no `enum`, `namespace` or parameter properties; imports keep the `.ts` extension.
- **Nothing is done without a test**: if you touch the physics (`params.ts`, `boat.ts`…), run `test:sim` and update
  the results table in the POC README. **Never loosen a criterion just to make a test pass** — a new limitation goes
  into the README and, if needed, into the `KNOWN` map in `tests/sim.test.ts`.
- **Languages:** code, comments and the UI are written in **Brazilian Portuguese**. Every new on-screen text needs an
  English entry in [`pocs/babylon/src/platform/i18n.en.ts`](pocs/babylon/src/platform/i18n.en.ts) (use `{}` for
  variable parts). To check, play with `?lang=en` and run `__i18nMissing()` in the console. English-speaking
  contributors are welcome to write comments and commit messages in English.
- **No manufacturer names or trademarks** in the game's texts.
- Update `README.md` (and `README.en.md`) when the change is visible to players.

## License

By contributing, you agree that your contribution will be distributed under the project's [MIT license](LICENSE).

## Community

This project follows a [Code of Conduct](CODE_OF_CONDUCT.en.md). Be kind and patient — everyone here is learning and
building together.
