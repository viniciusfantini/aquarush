# Comparativo das POCs (GDD §11)

Nota de 1 a 5 por critério, com vídeo e medições reproduzíveis. A coluna "Peso" segue o GDD. Uma célula vazia significa que ainda não há avaliação, e **nenhuma nota é dada sem medição**.

| Critério | Peso | Babylon.js | Unity 6 + URP | Unreal |
|---|---|---|---|---|
| Sensação de pilotagem | 25% | *pendente de avaliação por pessoa* | | |
| Água e interação | 20% | | | |
| Desempenho mobile | 15% | *não medido* | | |
| Desempenho Web | 15% | desktop: ~86 FPS, física 0,14 ms (ver README da POC) | | |
| Qualidade visual | 10% | | | |
| Velocidade de desenvolvimento | 10% | fatia completa em 1 sessão com IA | | |
| Evolução e manutenção | 5% | física desacoplada e testável em Node | | |

## Condições de teste registradas

| POC | Aparelho / SO | Navegador / Build | Resolução | Qualidade | Versão |
|---|---|---|---|---|---|
| Babylon | PC Windows 11 Home (26200) | Chrome, WebGL2, servidor dev | ~1370×896 | med | poc-babylon 0.1.0 |

## Notas

- O roteiro de física (GDD A.12, testes 1–6) da POC Babylon roda de forma automática (`npm run test:sim`). Os resultados estão em `pocs/babylon/README.md`.
- As POCs Unity e Unreal devem reproduzir os mesmos parâmetros (`pocs/babylon/src/sim/params.ts`) e o mesmo roteiro.
