import { describe, expect, it } from "vitest";
import { decodeWav, extractEnvelope, generateSilenceWav, WavDecodeError } from "../lib/video/wav";

function makePcm16Wav(samples: number[], sampleRate = 8000): Buffer {
  const dataSize = samples.length * 2;
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
  samples.forEach((s, i) => buffer.writeInt16LE(s, 44 + i * 2));
  return buffer;
}

describe("decodeWav", () => {
  it("decodes a PCM16 mono WAV's sample rate, duration and samples", () => {
    const wav = makePcm16Wav([0, 16384, -16384, 0], 8000);
    const decoded = decodeWav(wav);
    expect(decoded.sampleRate).toBe(8000);
    expect(decoded.channels).toBe(1);
    expect(decoded.bitsPerSample).toBe(16);
    expect(Array.from(decoded.samples)).toEqual([0, 16384, -16384, 0]);
    expect(decoded.durationSeconds).toBeCloseTo(4 / 8000, 6);
  });

  it("throws on a non-WAV buffer", () => {
    expect(() => decodeWav(Buffer.from("not a wav file at all"))).toThrow(WavDecodeError);
  });

  it("throws on stereo/non-PCM16 input rather than silently misreading it", () => {
    const wav = makePcm16Wav([0, 0]);
    wav.writeUInt16LE(2, 22); // claim 2 channels without changing the data layout
    expect(() => decodeWav(wav)).toThrow(WavDecodeError);
  });
});

describe("extractEnvelope", () => {
  it("normalizes RMS amplitude to [0, 1] against the loudest frame", () => {
    // 8000Hz, 8 samples/frame at fps=1000 -> 1 sample per frame at 8000fps is unwieldy;
    // use fps=1 with 8000 samples/frame instead so each "frame" is the whole second.
    const quiet = makePcm16Wav(new Array(8000).fill(100), 8000);
    const loud = makePcm16Wav(new Array(8000).fill(30000), 8000);

    const quietEnvelope = extractEnvelope(decodeWav(quiet), 1);
    const loudEnvelope = extractEnvelope(decodeWav(loud), 1);

    expect(quietEnvelope).toEqual([1]); // only frame, so it IS the peak -> normalized to 1
    expect(loudEnvelope).toEqual([1]);
  });

  it("gives the loudest frame amplitude 1 and quieter frames a smaller value", () => {
    const silentFrame = new Array(100).fill(0);
    const loudFrame = new Array(100).fill(32767);
    const wav = makePcm16Wav([...silentFrame, ...loudFrame], 200); // 2 frames at fps=1 (100 samples/frame)
    const envelope = extractEnvelope(decodeWav(wav), 2);

    expect(envelope[0]).toBe(0);
    expect(envelope[1]).toBeCloseTo(1, 5);
  });

  it("returns all zeros for pure silence instead of dividing by zero", () => {
    const wav = makePcm16Wav(new Array(400).fill(0), 8000);
    const envelope = extractEnvelope(decodeWav(wav), 10);
    expect(envelope.every((v) => v === 0)).toBe(true);
  });
});

describe("generateSilenceWav", () => {
  it("produces a valid, decodable silent WAV of the requested duration", () => {
    const wav = generateSilenceWav(0.5, 8000);
    const decoded = decodeWav(wav);
    expect(decoded.durationSeconds).toBeCloseTo(0.5, 2);
    expect(Array.from(decoded.samples).every((s) => s === 0)).toBe(true);
  });
});
