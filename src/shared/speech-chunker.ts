// Prepares system audio for Whisper: resample to 16 kHz mono and cut it into
// utterances with a simple energy-based voice activity detector. A chunk ends
// after a pause (`silenceMs`) or when it reaches `maxMs`, so long monologues are
// still transcribed in pieces.

export const WHISPER_SAMPLE_RATE = 16000

export function resampleLinear(input: Float32Array, fromRate: number, toRate = WHISPER_SAMPLE_RATE): Float32Array {
 if (fromRate === toRate || input.length === 0) return input.slice()
 const ratio = fromRate / toRate
 const length = Math.max(0, Math.floor(input.length / ratio))
 const output = new Float32Array(length)
 for (let index = 0; index < length; index++) {
  const position = index * ratio
  const left = Math.floor(position)
  const right = Math.min(left + 1, input.length - 1)
  const weight = position - left
  output[index] = input[left] * (1 - weight) + input[right] * weight
 }
 return output
}

export type ChunkerOptions = { sampleRate?: number; threshold?: number; silenceMs?: number; maxMs?: number; minSpeechMs?: number; preRollMs?: number }

export function createSpeechChunker(options: ChunkerOptions = {}) {
 const rate = options.sampleRate ?? WHISPER_SAMPLE_RATE
 const threshold = options.threshold ?? 0.01
 const block = Math.round(rate * 0.02)
 const silenceBlocks = Math.ceil((options.silenceMs ?? 700) / 20)
 const maxSamples = Math.round(rate * (options.maxMs ?? 8000) / 1000)
 const minSpeechBlocks = Math.ceil((options.minSpeechMs ?? 400) / 20)
 const preRollBlocks = Math.ceil((options.preRollMs ?? 200) / 20)

 let carry = new Float32Array(0)
 let preRoll: Float32Array[] = []
 let current: Float32Array[] = []
 let currentLength = 0
 let speechBlocks = 0
 let silentRun = 0
 let inSpeech = false

 const finish = (): Float32Array | null => {
  const blocks = current
  const voiced = speechBlocks
  current = []; currentLength = 0; speechBlocks = 0; silentRun = 0
  if (voiced < minSpeechBlocks) return null
  const total = blocks.reduce((sum, part) => sum + part.length, 0)
  const output = new Float32Array(total)
  let offset = 0
  for (const part of blocks) { output.set(part, offset); offset += part.length }
  return output
 }

 return {
  push(samples: Float32Array): Float32Array[] {
   const chunks: Float32Array[] = []
   const data = new Float32Array(carry.length + samples.length)
   data.set(carry); data.set(samples, carry.length)
   let offset = 0
   for (; offset + block <= data.length; offset += block) {
    const frame = data.slice(offset, offset + block)
    let energy = 0
    for (const value of frame) energy += value * value
    const voiced = Math.sqrt(energy / frame.length) >= threshold
    if (!inSpeech) {
     preRoll.push(frame)
     if (preRoll.length > preRollBlocks) preRoll.shift()
     if (voiced) {
      inSpeech = true
      current = preRoll; currentLength = preRoll.reduce((sum, part) => sum + part.length, 0)
      preRoll = []; speechBlocks = 1; silentRun = 0
     }
     continue
    }
    current.push(frame); currentLength += frame.length
    if (voiced) { speechBlocks++; silentRun = 0 } else silentRun++
    if (silentRun >= silenceBlocks) {
     inSpeech = false
     const chunk = finish()
     if (chunk) chunks.push(chunk)
    } else if (currentLength >= maxSamples) {
     const chunk = finish()
     if (chunk) chunks.push(chunk)
    }
   }
   carry = data.slice(offset)
   return chunks
  },
  flush(): Float32Array | null {
   inSpeech = false
   carry = new Float32Array(0)
   preRoll = []
   return finish()
  },
 }
}

// Whisper tends to "hear" stock phrases in noise or music; drop those outputs.
export function isWhisperNoise(text: string) {
 const clean = text.trim().toLowerCase().replace(/[.!?,\s]+$/g, '')
 if (clean.length < 2) return true
 if (/^[\[(].*[\])]$/.test(clean)) return true
 return ['thank you', 'thanks for watching', 'thank you for watching', 'you', 'bye', 'subtitles by the amara.org community', 'cảm ơn các bạn đã theo dõi', 'hãy subscribe cho kênh'].includes(clean)
}
