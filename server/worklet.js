/**
 * AudioWorklet du serveur (page de test uniquement).
 * Identique a extension/pcm-worklet.js : accumulation par blocs de 128 ms.
 */
const BLOCK = 2048; // echantillons -> 128 ms a 16 kHz

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Int16Array(BLOCK);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      for (let i = 0; i < channel.length; i += 1) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        this.block[this.filled] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.filled += 1;
        if (this.filled === BLOCK) {
          const out = this.block.slice(0);
          this.port.postMessage(out.buffer, [out.buffer]);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
