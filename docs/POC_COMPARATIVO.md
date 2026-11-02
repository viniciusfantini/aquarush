# Comparativo das POCs (GDD §11)

Nota de 1 a 5 por critério, com vídeo e medições reproduzíveis. A coluna "Peso" segue o GDD. Uma célula vazia significa que ainda não há avaliação, e **nenhuma nota é dada sem medição**.

| Critério | Peso | Babylon.js | Unity 6 + URP | Unreal |
|---|---|---|---|---|
| Sensação de pilotagem | 25% | *pendente de avaliação por pessoa* | | |
| Água e interação | 20% | | | |
| Desempenho mobile | 15% | *não medido* | | |
| Desempenho Web | 15% | desktop (v0.2, med, 1775×1161, com reflexo planar): ~85 FPS; física 0,14 ms. v0.48.2 (mundo completo, 4 embarcações, 388 malhas ativas, Chrome automatizado): 27–45 FPS — precisa ser medido de novo sem a automação | | |
| Qualidade visual | 10% | | | |
| Velocidade de desenvolvimento | 10% | fatia completa em 1 sessão com IA; até a v0.48: 4 embarcações (popa, bote, dois V8, turbina), sistemas elétricos e de porão, rampa/carretinha, estrada e posto | | |
| Evolução e manutenção | 5% | física desacoplada e testável em Node | | |

## Condições de teste registradas

| POC | Aparelho / SO | Navegador / Build | Resolução | Qualidade | Versão |
|---|---|---|---|---|---|
| Babylon | PC Windows 11 Home (26200) | Chrome, WebGL2, servidor dev | ~1370×896 | med | poc-babylon 0.1.0 |
| Babylon | PC Windows 11 Home (26200) | Chrome, WebGL2, servidor dev | 1775×1161 (render) | med | poc-babylon 0.2.0 |
| Babylon | PC Windows 11 Home (26200) | Chrome (com a extensão de automação), WebGL2, servidor dev | 1775×1218 (render) | med | poc-babylon 0.48.2 |

## Notas

- O roteiro de física (GDD A.12, testes 1–6) da POC Babylon roda de forma automática (`npm run test:sim`). Os resultados estão em `pocs/babylon/README.md`.
- As POCs Unity e Unreal devem reproduzir os mesmos parâmetros (`pocs/babylon/src/sim/params.ts`: as 4 embarcações; a turbina em `sim/turbine.ts`) e o mesmo roteiro (`tests/sim.test.ts`, 479 critérios na v0.48.2).
