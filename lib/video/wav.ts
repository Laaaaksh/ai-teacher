/**
 * Minimal WAV (RIFF/PCM) decode + envelope extraction. Sarvam's bulbul:v3
 * TTS is verified (docs/ARCHITECTURE.md) to return mono 16-bit PCM WAV; this
 * only supports that shape and throws rather than silently misreading a
 * different one.
 */

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Interleaved PCM16 samples. */
  samples: Int16Array;
  durationSeconds: number;
}

export class WavDecodeError extends Error {}

export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new WavDecodeError("Not a RIFF/WAVE buffer.");
  }

  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  let data: Buffer | undefined;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, offset + 8 + chunkSize);

    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bitsPerSample: body.readUInt16LE(14),
      };
    } else if (chunkId === "data") {
      data = body;
    }

    offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (!fmt || !data) {
    throw new WavDecodeError("WAV is missing an fmt or data chunk.");
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16 || fmt.channels !== 1) {
    throw new WavDecodeError(
      `Unsupported WAV format: audioFormat=${fmt.audioFormat} channels=${fmt.channels} bitsPerSample=${fmt.bitsPerSample} (expected PCM16 mono).`,
    );
  }

  const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
  const durationSeconds = samples.length / fmt.sampleRate;

  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, samples, durationSeconds };
}

/**
 * RMS amplitude envelope, one value per output frame at `fps`, normalized to
 * [0, 1] against the loudest frame in the clip. This drives the avatar's
 * mouth — an amplitude-bucketed viseme approximation, not true phoneme-level
 * lip-sync (there is no forced-alignment/phoneme timing available from
 * Sarvam TTS), documented in docs/VIDEO.md.
 */
export function extractEnvelope(wav: DecodedWav, fps: number): number[] {
  const samplesPerFrame = wav.sampleRate / fps;
  const frameCount = Math.max(1, Math.ceil(wav.samples.length / samplesPerFrame));
  const raw: number[] = new Array(frameCount);

  let peak = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const start = Math.floor(frame * samplesPerFrame);
    const end = Math.min(wav.samples.length, Math.floor((frame + 1) * samplesPerFrame));
    let sumSquares = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const normalized = wav.samples[i] / 32768;
      sumSquares += normalized * normalized;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    raw[frame] = rms;
    if (rms > peak) peak = rms;
  }

  if (peak === 0) return raw.map(() => 0);
  return raw.map((v) => Math.min(1, v / peak));
}

/** A silent mono PCM16 WAV of the given duration, used for the title card and any padding audio. */
export function generateSilenceWav(durationSeconds: number, sampleRate = 22050): Buffer {
  const numSamples = Math.max(1, Math.round(durationSeconds * sampleRate));
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
