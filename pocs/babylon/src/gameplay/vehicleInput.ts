// Contrato de entrada (GDD 9.2). Os controladores NÃO conhecem o dispositivo de origem:
// teclado, gamepad e touch são traduzidos para VehicleInput pelos adaptadores em platform/.

export interface VehicleInput {
  /** Acelerador 0..1 (progressivo). */
  throttle: number;
  /** Direção -1 (bombordo/esquerda) .. +1 (boreste/direita). */
  steering: number;
  /** Comando de trim -1 (baixar proa) .. +1 (elevar proa). É uma taxa: segurar move o trim. */
  trim: number;
  /** Freio/reverso 0..1: em movimento à frente aplica empuxo reverso; parado engata ré. */
  brake: number;
  /** Forçar marcha à ré (botão dedicado). */
  reverse: boolean;
  /** Reservado (porão) — fora do escopo da POC 1. */
  bilgePump: boolean;
  /** Luzes de navegação (estado). */
  navigationLights: boolean;
}

export const emptyInput = (): VehicleInput => ({
  throttle: 0,
  steering: 0,
  trim: 0,
  brake: 0,
  reverse: false,
  bilgePump: false,
  navigationLights: false,
});
