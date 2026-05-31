// G.711 μ-law codec. Twilio Media Streams uses 8kHz mono μ-law-encoded PCM.
// Reference: ITU-T G.711, table 2a. Branchless lookup variants exist but
// the table-driven decode below is plenty fast for our 8000-samples/sec
// budget and stays readable.

const BIAS = 0x84;

export function decodeMuLawToPcm16(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = MULAW_DECODE_TABLE[bytes[i]];
  }
  return out;
}

export function encodePcm16ToMuLaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm16ToMuLaw(pcm[i]);
  }
  return out;
}

const MULAW_DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const inverted = ~i & 0xff;
    const sign = inverted & 0x80;
    const exponent = (inverted >> 4) & 0x07;
    const mantissa = inverted & 0x0f;
    let sample = ((mantissa << 3) + BIAS) << exponent;
    sample -= BIAS;
    table[i] = sign ? -sample : sample;
  }
  return table;
})();

function pcm16ToMuLaw(sample: number): number {
  const MAX = 32635;
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > MAX) sample = MAX;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent -= 1;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
