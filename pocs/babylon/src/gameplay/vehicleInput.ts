// Contrato de entrada (GDD 9.2). Os controladores NÃO conhecem o dispositivo de origem:
// teclado, gamepad e touch são traduzidos para VehicleInput pelos adaptadores em platform/.

export type GearCommand = "F" | "N" | "R";

export interface VehicleInput {
  /** Marcha pedida pela manete: F (frente), N (neutro), R (ré). A troca real passa por N com atraso (sim). */
  gear: GearCommand;
  /** Acelerador 0..1 ACIMA da marcha lenta, na marcha engatada (0 = lenta engrenada: a lancha anda devagar). */
  throttle: number;
  /** Direção -1 (bombordo/esquerda) .. +1 (boreste/direita). */
  steering: number;
  /** Comando de trim -1 (baixar proa) .. +1 (elevar proa). É uma taxa: segurar move o trim. */
  trim: number;
  /** @deprecated substituído por `gear` (manete com detentes F/N/R). Mantido no contrato do GDD 9.2. */
  brake: number;
  /** @deprecated substituído por `gear`. */
  reverse: boolean;
  /** Interruptor manual da bomba de porão (a boia automática liga sozinha com água). */
  bilgePump: boolean;
  /** Guincho da âncora de proa: +1 paga cabo (lança), −1 recolhe, 0 parado. */
  anchor: number;
  /** Manetes separadas (barco de dois motores: [bombordo, boreste]). Ausente = as duas seguem `gear`/`throttle`. */
  engineCmd?: { gear: GearCommand; throttle: number }[];
  /** Luzes de navegação (estado). */
  navigationLights: boolean;
  /** Botão de aceleração em neutro segurado: com a marcha em N o acelerador sobe o giro sem engatar. */
  neutralThrottle: boolean;
}

export const emptyInput = (): VehicleInput => ({
  gear: "N",
  throttle: 0,
  steering: 0,
  trim: 0,
  brake: 0,
  reverse: false,
  bilgePump: false,
  navigationLights: false,
  neutralThrottle: false,
  anchor: 0,
});
