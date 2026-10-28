export const ARENA_RADIUS_MM = 25;
export const MM_TO_SCENE = 0.1;

export type StimulusKind = "pursuit_target";
export type ControlMode = "brain" | "mirror" | "none";

export interface StimulusSetup {
  kind: StimulusKind;
  // Fly-scale arena coordinates in millimetres. x<0 is screen-left; z<0 is forward.
  x: number;
  z: number;
  summary: string;
}

export interface SimulationResult {
  model: string;
  control: ControlMode;
  points: Array<{ t: number; x: number; z: number; yaw: number; turnLeftHz: number; turnRightHz: number }>;
  target: { x: number; z: number };
  caveat: string;
}
