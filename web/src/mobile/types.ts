export type LoadPhase = 'error' | 'loading' | 'ready'

export interface ScopedLoadState {
  phase: LoadPhase
  scope: string | null
}
