export async function playNarration(
  text: string,
  audioContext: AudioContext
): Promise<number> {
  if (!audioContext) { console.warn('[audio] no ctx'); return 3 }
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
  if (audioContext.state !== 'running') {
    console.warn('[audio] ctx not running:', audioContext.state)
    return 3
  }
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 400), voice: 'af_heart' })
    })
    if (!res.ok) { console.error('[audio] tts:', res.status); return 3 }
    const buf = await res.arrayBuffer()
    console.log('[audio] bytes:', buf.byteLength)
    if (buf.byteLength < 100) { console.error('[audio] empty buffer'); return 3 }
    const decoded = await audioContext.decodeAudioData(buf.slice(0))
    const src = audioContext.createBufferSource()
    src.buffer = decoded
    src.connect(audioContext.destination)
    src.start(0)
    console.log('[audio] playing, duration:', decoded.duration)
    return decoded.duration
  } catch (err) {
    console.error('[audio] error:', err)
    return 3
  }
}
