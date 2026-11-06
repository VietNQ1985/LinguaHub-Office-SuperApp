/** Only reconcile within the caller's current conversation generation. */
export function reconcileStreamingMessage<T extends { key: string; text: string; status: string; partialTranslation?: string; timing?: unknown }>(next: T, previous?: { key: string; text: string; partialTranslation?: string; timing?: T["timing"] }): T {
  if (!previous || next.key !== previous.key || next.text !== previous.text || next.status !== 'translating') return next
  return { ...next, partialTranslation: previous.partialTranslation, timing: previous.timing }
}
