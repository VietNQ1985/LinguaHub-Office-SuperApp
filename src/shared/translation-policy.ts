export const FALLBACK_TRANSLATION_SCAN_MS = 1800
export const IDLESS_MESSAGE_CONFIRMATION_MS = 160
export const PRIORITY_TRANSLATION_BATCH_MESSAGES = 1
export const MAX_TRANSLATION_BATCH_MESSAGES = 4

export function newestFirst<T>(items: ReadonlyArray<T>, limit: number) {
  return [...items].reverse().slice(0, limit)
}

export function nextTranslationBatch<T>(items: ReadonlyArray<T>, priorityKey: string | null, keyOf: (item: T) => string, prioritizeNewest = false) {
  const pending = newestFirst(items, MAX_TRANSLATION_BATCH_MESSAGES)
  if (!pending.length) return null
  const priority = priorityKey === null ? undefined : pending.find(item => keyOf(item) === priorityKey)
  const first = priority || (prioritizeNewest ? pending[0] : undefined)
  if (first) return { lane: 'priority' as const, messages: [first].slice(0, PRIORITY_TRANSLATION_BATCH_MESSAGES) }
  return { lane: 'backlog' as const, messages: pending }
}

export function translationCacheScope(conversationId: string, messageId?: string) {
  return JSON.stringify([conversationId, messageId || 'content'])
}

// Letters that only Vietnamese uses (tone marks and ă â đ ê ô ơ ư). Messages clearly written in
// Vietnamese are skipped on the machine instead of being sent to the AI, which often echoes them back.
const VIETNAMESE_LETTER=/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu
export function looksVietnamese(text:string){
  const letters=(text.match(/\p{L}/gu)||[]).length
  if(!letters)return false
  const vietnamese=(text.match(VIETNAMESE_LETTER)||[]).length
  // A single accented name inside an English sentence ("Thanks Tuấn") must still be translated.
  return vietnamese/letters>=0.08&&(vietnamese>=2||letters<=8)
}
