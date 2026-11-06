import { expect, test } from 'vitest'
import { createSpeechChunker, resampleLinear } from './speech-chunker'

const tone = (ms: number, amplitude = 0.2, rate = 16000) => Float32Array.from({ length: Math.round(rate * ms / 1000) }, (_, i) => amplitude * Math.sin(i / 5))
const silence = (ms: number, rate = 16000) => new Float32Array(Math.round(rate * ms / 1000))
const join = (...parts: Float32Array[]) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return out }

test('resampling 48 kHz to 16 kHz keeps duration',()=>{
 expect(resampleLinear(new Float32Array(48000),48000).length).toBe(16000)
 expect(resampleLinear(new Float32Array(44100),44100).length).toBe(16000)
 expect(Array.from(resampleLinear(Float32Array.from([0,1,2,3,4,5]),3,1))).toEqual([0,3])
})

test('speech followed by a pause becomes one chunk with pre-roll',()=>{
 const chunker=createSpeechChunker()
 const chunks=chunker.push(join(silence(500),tone(1000),silence(800)))
 expect(chunks).toHaveLength(1)
 expect(chunks[0].length/16000).toBeGreaterThan(1.1)
 expect(chunks[0].length/16000).toBeLessThan(2)
})

test('short noise is ignored and silence produces nothing',()=>{
 const chunker=createSpeechChunker()
 expect(chunker.push(join(silence(300),tone(100),silence(1000)))).toEqual([])
 expect(chunker.push(silence(2000))).toEqual([])
 expect(chunker.flush()).toBeNull()
})

test('long speech is split at the maximum length and works across pushes',()=>{
 const chunker=createSpeechChunker({maxMs:3000})
 const audio=tone(7000)
 const chunks:Float32Array[]=[]
 for(let i=0;i<audio.length;i+=4096)chunks.push(...chunker.push(audio.slice(i,i+4096)))
 expect(chunks).toHaveLength(2)
 const rest=chunker.flush()
 expect(rest).not.toBeNull()
 expect(chunks.reduce((n,c)=>n+c.length,0)+rest!.length).toBeGreaterThan(16000*6.9)
})

test('typical Whisper hallucinations are filtered, real speech is kept',async()=>{
 const { isWhisperNoise } = await import('./speech-chunker')
 for(const text of ['',' . ','[BLANK_AUDIO]','(music)','Thank you.','Thanks for watching!','you'])expect(isWhisperNoise(text)).toBe(true)
 for(const text of ['We ship on Friday.','Thank you for the update on inventory.'])expect(isWhisperNoise(text)).toBe(false)
})
