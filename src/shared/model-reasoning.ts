export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningEffort = typeof REASONING_EFFORTS[number]

export const DEFAULT_CHATGPT_MODEL = 'chatgpt:gpt-6-luna'
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'max'
export const DEFAULT_TRANSLATION_REASONING_EFFORT: ReasoningEffort = 'low'
export const FAST_REASONING_EFFORT: ReasoningEffort = 'low'

export function isGpt6Model(model: string) {
  return /^gpt-6(?:[.-]|$)/i.test(model)
}
