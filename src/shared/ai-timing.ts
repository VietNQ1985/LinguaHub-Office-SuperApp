export type AiResponseTiming = {
  requestMs: number
  firstResponseMs: number | null
  completionMs: number
}

export type AiTimingUpdate = Partial<AiResponseTiming>
export type AiTimingHandler = (timing: AiTimingUpdate) => void
export type AiTextHandler = (delta: string) => void
