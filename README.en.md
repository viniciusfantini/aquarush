# AQUA RUSH

🇧🇷 [Leia em português](README.md) · 🇺🇸 English

Open-world 3D boating game for **mobile and web browsers**.

**▶ Play online (Babylon POC):** https://viniciusfantini.github.io/aquarush/ — runs in desktop and mobile browsers (touch controls are enabled automatically). The game is available in **Portuguese and English** (language button on the splash screen, or add `?lang=en` to the URL). The core of the game is the feel of driving a boat and its interaction with the water.

The design document (GDD + architecture + POC plan) is [`docs/AQUA_RUSH_GDD_COMPLETO_v2.docx`](docs/AQUA_RUSH_GDD_COMPLETO_v2.docx) (in Portuguese). A plain-text version, handy for searching, is in [`docs/GDD_texto_extraido.txt`](docs/GDD_texto_extraido.txt).

## Strategy

The GDD (section 10) calls for the **same playable slice** to be built in three technologies before choosing the final engine. The POCs go from the simplest to the most complex:

| # | Technology | Folder | Status |
|---|---|---|---|
| 1 | **Babylon.js + TypeScript** (browser-first, no engine to install) | [`pocs/babylon`](pocs/babylon) | ✅ **v0.69.3** (online) — **Portuguese and English**. Six craft on the same physics: **AR-6 runabout** (150 hp outboard), **AR-3 inflatable tender** (15 hp tiller), **AR-P airboat** (260 hp aircraft engine with a caged pusher air propeller, air rudders, foot throttle, no reverse; slides over mud and grass), **AR-J personal watercraft** (300 hp supercharged water jet: handlebar, throttle trigger, iBB brake/reverse, START/STOP with safety lanyard, ECO mode; the rider rights it after a capsize), **AR-9 performance boat** (twin 300 hp V8 sterndrives with differential thrust) and **AR-10 turbine boat** (1100 shp gas turbine, surface-piercing prop, real turbine start with N1/N2/EGT). Custom physics tested in Node (**668/670 criteria + 2 documented limitations**); engine systems (fuel, temperature, battery with a real discharge curve, alternator, ammeter, jump starter; **two battery banks** on the AR-9 and **24 V** with a dock GPU on the AR-10); **bilge pump**, **swamping and sinking**; **bow anchor** with windlass; **wind** in 5 levels; hull and engine damage; concrete ramp, trailer and car/pickup; road to the gas station, mooring buoys, restaurant; capsizing with people in life jackets swimming back; **Space bar**: passengers, then the driver, jump in and climb back aboard; **Y** panels with switches, levers, trim, horn/whistle and the turbine start panel (FADEC/manual, checklist); glassy water, a wake the physics feels, cavitation |
| 2 | Unity 6 LTS + URP | [`pocs/unity`](pocs/unity) | ⏳ planned (Unity is not installed on this machine) |
| 3 | Unreal Engine 5 | [`pocs/unreal`](pocs/unreal) | ⏳ planned |

The comparison between POCs, using the weights of the GDD §11 matrix, is recorded in [`docs/POC_COMPARATIVO.md`](docs/POC_COMPARATIVO.md).

All electrical and engine-system logic (batteries, master switch, alternator, GPU, fuel, cooling, ignition keys, electric and pull starts, choke, turbine with FADEC and manual start, oil, bilge, windlass, telemetry and test criteria) is documented in [`docs/SISTEMAS_ELETRICOS_E_MOTORES.md`](docs/SISTEMAS_ELETRICOS_E_MOTORES.md) (in Portuguese), so the work can continue in another AI tool or be ported to Unity/Unreal. The **AR-10 electrical diagram** (sources, 24 V bus, loads, FADEC, sensors and annunciators) is a PDF (in Portuguese): [`docs/diagramas/AR-10_diagrama_eletrico.pdf`](docs/diagramas/AR-10_diagrama_eletrico.pdf).

## Running POC 1 (Babylon.js)

Requirements: Node.js 22.18+ (tested with 24.16).

```bash
cd pocs/babylon
npm install
npm run dev          # http://localhost:5173  (also reachable on the local network, to test on a phone)
npm run test:sim     # GDD A.12 physics script (tests 1–6 and more) without a browser
npm run typecheck
npm run build        # builds dist/ (static site)
npm run deploy       # typecheck + tests + build, then publishes to GitHub Pages (gh-pages branch)
```

URL parameters: `?barco=lancha|bote|airboat|jetski|rapida|turbina` (skips the craft selection; `lancha` = AR-6, `bote` = AR-3, `airboat` = AR-P, `jetski` = AR-J, `rapida` = AR-9, `turbina` = AR-10), `?lang=en|pt`, `?q=low|med|high` (quality), `?webgpu=1`, `?touch=1` (forces touch controls).

The game opens on an **illustrated splash screen** (a sunset over a canyon lake) with the **PLAY** button and the **language** selector (Português do Brasil / English). PLAY leads to the craft selection.

The **selection menu is already on the lake**: the chosen craft floats at the pier and the camera orbits it (a real preview, with the same physics). Pick the **AR-3 Tender** (3.1 m, 15 hp, up to 3 people, tiller, pull start, manual trim, hand lantern; 10 L portable tank, starts with 5 L), the **AR-6 Runabout** (6 m, 150 hp, wheel, throttle lever, power trim, key start, navigation lights; 120 L tank, starts with 5 L), the **AR-P Airboat** (4.9 m, up to 3 people, 260 hp air-cooled aircraft engine, 2-blade pusher propeller in a cage, air rudders on a stick, foot throttle, no clutch or reverse; 80 L tank, starts with 10 L), the **AR-J Personal Watercraft** (3.45 m, 300 hp supercharged, up to 3 riders, water jet; 70 L tank, starts with 8 L), the **AR-9 Performance Boat** (8.6 m, 2 seats, twin 300 hp V8s, one tachometer per engine, differential thrust; 380 L tank, starts with 20 L) or the **AR-10 Turbine Boat** (10 m, single pilot in an enclosed cockpit, 1100 shp gas turbine, surface-piercing prop, turbine panel with N1, EGT, torque, N2 and oil; 900 L tank, starts with 120 L) and press **RIDE**. The **CHANGE BOAT** chip goes back to the menu without reloading.

### Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| **Throttle lever F / N / R** | tap **S/↓**: F → **N** (no thrust) → **R** (idle reverse). Tap **W/↑**: R → **N** → **F** (idle forward) | LT / RT or D-pad ↓ / ↑ | lever on the right: white band = N, just above = F idle, just below = R idle |
| Accelerate in the engaged gear | **hold** W (in F) or S (in R); releasing returns to idle, still engaged | hold RT / LT (analog) | drag the lever away from N |
| **Rev in neutral** (warm up/test: rpm rises without engaging) | hold **N** + W, or the lever's N button / the tiller grip in N on the Y panel | | |
| Steering | A D / ← → | left stick | joystick on the left |
| Trim + / − (power trim, hold) | E / Q | RB / LB | TRIM+ / TRIM− |
| **Differential thrust** (AR-9 only): one engine in reverse and the other forward, spins in place | hold **Z** (to port) / **X** (to starboard) | | |
| **Tender: manual trim** (whenever not accelerating) | tap **E/Q**: pin 1 · 2 · 3; **E** on pin 3 tilts the engine all the way up; **Q** lowers it | RB / LB | TRIM+ / TRIM− |
| **Tilt the engine up** | hold **E** at the end of the trim range, at **low rpm** (may be engaged and moving slowly); **Q** lowers it | hold RB | hold TRIM+ |
| **Airboat (AR-P)**: no gearbox — with the engine running the propeller already pushes; **hold W** = foot throttle (S does nothing: no reverse or brake); **A/D** = air rudders, which only turn the boat with throttle (blip it to turn from a stop); it glides over mud and grass banks with momentum | W · A/D · P | | |
| **Personal watercraft (AR-J)**: P = START/STOP (in N, with the **safety lanyard** on); while moving forward, **hold S** = the **iBB** lever: the bucket drops and **brakes** (once stopped, it reverses); release returns to forward; **tap S = N**. **iBB** light on the HUD and the Y panel (off = forward, amber = NEUTRAL/REVERSE, flashing red = BRAKE) and the **BOOST** gauge of the supercharger; hard braking at speed throws a column of water up behind the stern | P · S · E/Q · Y | | |
| **Turbine (AR-10)**: P starts it (starter → ignition at 12 % N1 → light-off → starter off at 45 % → idle at 62 %, ~20 s); P again aborts or cuts the fuel (spool-down) | P | B | ⏻ |
| **Start/stop the engine** (start only in N; on the tender, each P is one pull of the cord). The game starts with the engine **off** and the battery at **60 %**. With two or more engines, P starts them one at a time: the next one cranks only after the previous one caught and settled at idle | P | B | ⏻ |
| **Jump starter** (10 Ah / 200 A booster; connect at any time; it disconnects by itself once the engine runs) | J | | bar button |
| **Dock GPU** (AR-10 only, instead of the jump starter): 28 V diesel generator; **two controls**: the **cable** (J, only when tied up at the pier berth) and the **EXT PWR** relay that puts it on the bus (automatic in FADEC; manual switch otherwise) | J | | bar button |
| **Systems panel** (piston boats): battery switch (OFF / ON; on the AR-9 OFF / IND. / PORT / STBD / BOTH), fuel tank valve, choke (carbureted tender), bilge pump OFF / AUTO / ON, lights, levers, trim and horn/whistle; on the AR-J: START/STOP, safety lanyard, ECO/SPORT, throttle trigger, iBB and VTS; draggable | Y | | bar button |
| **Turbine start panel** (AR-10): FADEC (automatic: START / STOP) or MANUAL (every switch by hand; nothing protects the turbine); analog gauges with green/yellow/red bands, annunciator lights, lamp TEST, checklist | Y | | bar button |
| **Bow anchor**: hold to pay out / retrieve the rode (electric windlass on the larger boats, by hand on the tender and the AR-J) | **+** / **−** | | ⚓+ / ⚓− |
| **Wind**: none → light → moderate → strong → storm | T | | WIND chip |
| Water: glass / calm / lake / rough | 0 (or G) / 1 / 2 / 3 · V cycles | | WATER chip |
| **Boarding**: how many passengers to take (only **tied up at the pier berth**, where they wait standing) | O | | PEOPLE chip |
| **Abandon ship**: 1st press the passengers jump, 2nd press the driver too (the kill switch stops the engine); they swim back (~1.1 m/s with life jackets) and climb aboard when close (boat upright, ≤ 3 km/h) | Space | | |
| Reset: back **tied up at the pier berth** (starting fuel, battery at 60 %, engine off; rights the boat and everyone is back aboard) | R | Back | ↺ |
| External ↔ cockpit camera | C | Y | CAM |
| Orbit the camera / **look underwater** (drag down: it goes below the surface, with muffled sound) | drag with the mouse | | |
| Navigation lights (brightness follows the battery voltage) · hand lantern (tender) | L | X | LIGHT |
| **Horn** (the car's when you are in it; otherwise the boat's — the tender and the AR-J have a whistle) | B (hold) | | B button |
| **Moor** (pier berth: parallel, close, slow) / **tie to a buoy** (bow slowly to the buoy): ties itself · **cast off** | M casts off · **K** goes to the car (with the boat moored) and back | | CAST OFF / CAR buttons |
| **Ramp**: drive onto the trailer, raise the engine and go up slowly, bow first and aligned; the strap hooks itself and control passes to the car | — | | |
| **Drive the car/pickup** (after the strap holds the boat) | W forward · S brake and, stopped, reverse · A/D steering · the boat's engine still works: P start/stop, E/Q trim/tilt | RT / LT + stick | |
| **U** with the boat on the trailer: in the car, hands control to the boat; on the boat, with the trailer **in the water** it releases the strap, **on dry land** it returns to the car | U | | |
| **Unhitch / hitch the trailer** (to hitch: back the hitch ball up to it) | I | | I button |
| **Refuel the boat at the gas station** (car stopped next to the pump, boat engine off) | F (again to stop) | | REFUEL button |
| Telemetry · pause · help | F3 · Esc · H | Start (pause) | |

### What the simulation does (summary)

- **Boat**: 6-DOF rigid body driven by forces and torques at 120 Hz (buoyancy at 6 points, planing, the hump, trim/tilt, cavitation, ventilation, currents, a wake the physics feels, wind). Weight and position of fuel, occupants and bilge water.
- **Propulsion**: the same physics for **one outboard** (AR-6, AR-3), **one air propeller** (AR-P airboat: high thrust line, always forward, air rudders in the prop wash, no clutch or reverse, air-cooled engine, a flat bottom that slides in turns and over land), **one water jet** (AR-J: thrust comes out of the nozzle the handlebar turns, only with the intake grate in the water; the iBB bucket gives neutral, reverse and braking; sealed hull with a jet-pump siphon; the rider rights the craft in the water), **twin inboard V8 sterndrives** (AR-9: each engine has its own gear, throttle, rpm, starter, prop, battery bank and temperature; each drive pushes at its own position, so it can spin in place with Z/X) and **one free-turbine gas turbine** (AR-10: N1, N2, EGT, torque, oil, governor, a real start with ignition and light-off, hot and hung starts, spool-down; a surface-piercing prop that runs half out of the water). On the AR-10 the pilot sits in an **enclosed cockpit**: if it flips, the pilot doesn't fall out.
- **Engine and electrics**: start with a self-test beep; 50 Ah battery with a lead-acid voltage curve (12.7 V full → ~10.2 V flat) and internal resistance; 35 A alternator (~9 A already at idle); ammeter; trim and windlass lose power with a flat battery (only the relay clicks); 10 Ah / 200 A jump starter; fuel, temperature and hour meter. AR-9: **two banks**, one per engine. AR-10: **24 V** (two 12 V batteries in series, 28 V starter-generator) and a **dock GPU** (28 V diesel generator on a cart at the pier, with a crew member in a yellow vest). Turbine start by **FADEC** (automatic) or **MANUAL** (Y panel, switch by switch): doing it in the wrong order gives a real turbine's faults — early fuel (hot start), fuel without ignition (wet start with torching), starter released early (rollback), starter left on (overheats and locks out), overtemperature (wear until it seizes). AR-J: START/STOP buttons, safety lanyard, ECO mode, supercharger boost gauge.
- **Bilge**: water comes in through a hull hole (orifice, ∝ damage and level difference) and over the gunwale/transom (weir flow, less when moving); the 1500 GPH pump follows its flow × head curve and the battery voltage, and its jet leaves through the topsides.
- **Swamping and sinking** (runabout, driver only): in **calm water** freeboard goes from 64 cm (dry) to 36 cm with 1,500 L; **swamped/unnavigable at ~2,900 L**; **sinks at ~3,850 L**. **With waves it happens much sooner** (free-surface effect, water over the stern). The inflatable tender doesn't sink (tubes).
- **Anchor**: lowers, digs in, holds by scope (~5:1 holds even in a storm), drags with too little rode; the windlass pulls the boat when retrieving.
- **Wind**: 5 levels with gusts; drift (~3 % of the wind speed), heel and the bow falling off downwind; whitecaps. On a lake the wind doesn't raise waves (waves are on keys 0–3).
- **Effects**: wake and foam per prop, rooster tail, bubbles, cavitation mist; on the AR-10, **smoke and fire** from the exhaust following the turbine phase; on the AR-J, the iBB bucket and a water column when braking hard. Procedural sound for the outboard, the **V8s** (two voices), the **turbine** and the **supercharged 3-cylinder**.
- **World**: lake ~7 m deep in the middle with a dredged marina, a river and a canyon with channel buoys ending in a waterfall, the pier with a berth, mooring buoys, a ramp, a road to the gas station / store / workshop, a restaurant with a pool, a display fleet and parking spaces for the rigs (car/pickup + trailer) of the boats not in use.

**Temporary**: starting fuel is high for testing: **5 L** on the runabout and the tender, **10 L** on the AR-P, **8 L** on the AR-J, **20 L** on the AR-9 and **120 L** on the AR-10 (`START_FUEL` in `pocs/babylon/src/main.ts`).

## Contributing

The project is open and contributions are very welcome — code, physics, sound, visuals, translation, tests, ideas and
bug reports. Start with the [contributing guide](CONTRIBUTING.en.md) and the
[good first issues](docs/GOOD_FIRST_ISSUES.md); report bugs or suggest ideas through
[issues](https://github.com/viniciusfantini/aquarush/issues/new/choose). Every Pull Request is automatically checked
with typecheck, `test:sim` and a build (GitHub Actions). Taking part means following the
[Code of Conduct](CODE_OF_CONDUCT.en.md).

## License

[MIT](LICENSE) — you may use, copy, modify and distribute the code freely, keeping the copyright notice.

## Repository layout

```
README.md            Portuguese readme (README.en.md = this file)
CONTRIBUTING.md      how to contribute (CONTRIBUTING.en.md = English)
CODE_OF_CONDUCT.md   code of conduct (CODE_OF_CONDUCT.en.md = English)
LICENSE              MIT license
.github/             issue and Pull Request templates + CI (typecheck · test:sim · build on every PR)
CLAUDE.md            guide for AI agents (conventions, decisions, how to validate) — in Portuguese
docs/                original GDD + POC comparison + electrical/engine logic (SISTEMAS_ELETRICOS_E_MOTORES.md) + good first issues (GOOD_FIRST_ISSUES.md)
pocs/babylon/        POC 1 — Babylon.js (TypeScript + Vite)
pocs/unity/          POC 2 — planned
pocs/unreal/         POC 3 — planned
```

## Recent changes

The full, detailed change log (since v0.1) is in the Portuguese [README](README.md#registro-de-evolução). Latest versions:

| Date | Version | What changed |
|---|---|---|
| 2026-11-08 | repository | **Open to contributions**: **MIT** license, contributing guide and code of conduct (pt and en), issue and Pull Request templates, GitHub Actions CI (typecheck, `test:sim` and build on every PR and push to `main`) and the good first issues list (`docs/GOOD_FIRST_ISSUES.md`). |
| 2026-11-10 | babylon 0.69.3 | AR-P airboat **without an anchor** (none on the bow, + / − do nothing) and the Y-panel **IGNITION** light now only lights with the ignition on and the engine stopped (dark while running). 668/670 + 2 KNOWN. |
| 2026-11-10 | babylon 0.69.2 | AR-P airboat with a full **aircraft engine**: **dual magneto** key (OFF · R · L · BOTH · START; one mag = ~100 rpm drop, OFF stops the engine), **mixture** lever (RICH ↔ CUTOFF: leaning saves fuel, too lean loses power, CUTOFF shuts it down) and a **manual primer** (a cold engine needs 2–4 strokes; too many floods it). P runs the sequence by itself. **No trim** (the button does nothing); anchor, gear, draft and trim removed from its HUD; no TEST button. 667/669 + 2 KNOWN. |
| 2026-11-10 | babylon 0.69.1 | AR-P airboat: **2 air rudders** (was 3); the deck now sits on stringers above the waterline (before, the water showed inside the hull all the time, as if swamped); **warning lights on the Y panel** like the AR-10's (IGNITION, START, ALTERNATOR, OIL, CHT, LOW FUEL + TEST); 50 Ah battery and a 120 A geared starter (it didn't start at the 60 % starting charge). 656/658 + 2 KNOWN. |
| 2026-11-10 | babylon 0.69.0 | **Sixth craft: AR-P airboat** — 4.9 m flat aluminum hull, up to 3 people (high driver's seat), 260 hp aircraft engine, caged 2-blade pusher propeller, 3 air rudders on a stick, foot throttle. New `airProp` physics: air thrust (high, always forward), rudders in the prop wash (no turning without throttle), no clutch or reverse, sliding turns, gliding over mud and grass. ~88 km/h. 655/657 + 2 KNOWN. |
| 2026-11-10 | docs | AR-10 electrical diagram (PDF, 3 A3 sheets) in `docs/diagramas/`. |
| 2026-11-08 | babylon 0.68.5 | People in the water swim faster (up to ~1.1 m/s with life jackets). English README. |
| 2026-11-08 | babylon 0.68.4 | The AR-J uses the tender's ball whistle instead of a horn. |
| 2026-11-08 | babylon 0.68.3 | The jet bucket brake/reverse is now called **iBB**. |
| 2026-11-08 | babylon 0.68.2 | AR-J: no more false "cavitation" at low speed (the intake no longer ventilates in tight turns; less heel in turns). |
| 2026-11-08 | babylon 0.68.1 | Faster swimming; with two or more engines, P starts one engine at a time and waits for it to settle before starting the next. |
| 2026-11-08 | babylon 0.68.0 | **The game in English**: working language button on the splash, a single translation layer for the HUD, panels, messages, menu, help and 3D signs. |
| 2026-11-08 | babylon 0.67.x | **AR-J personal watercraft** (300 hp water jet): iBB bucket, VTS trim, START/STOP with safety lanyard, ECO mode, sealed hull with siphon, righting after a capsize, boost gauge, iBB light, water column when braking. |
| 2026-11-02 | babylon 0.66.x | Lake ~5× larger, waterfall with a strong current at the end of the canyon, "COMING SOON" banner at the start gate. |
