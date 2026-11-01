# POC 2: Unity 6 LTS + URP (planejada)

Ainda não iniciada: o Unity não está instalado na máquina de desenvolvimento.

Escopo (idêntico ao da POC 1, GDD §10.1 e Tarefa 001 do GDD §14):

- Unity 6 LTS + URP + Input System, com a versão fixada no início.
- Cena `PrototypeLake` com as mesmas dimensões e o mesmo layout (relevo em `pocs/babylon/src/sim/world.ts`).
- Lancha com Rigidbody e os **mesmos parâmetros** de `pocs/babylon/src/sim/params.ts` (massa, inércia, 6 pontos, coeficientes).
- `IWaterSurface` com ondas de Gerstner idênticas às de `sim/water.ts`, compartilhadas entre o shader e a física.
- `VehicleInput`, câmeras, HUD e o mesmo roteiro de testes (GDD A.12).
- Builds: desktop, Web e, se der tempo, Android.
