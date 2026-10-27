export const ARENA_RADIUS_M = 2.5;

export type StimulusKind = "pursuit_target" | "looming";

export interface StimulusSetup {
  kind: StimulusKind;
  x: number;
  z: number;
  intensity: number;
  summary: string;
}
