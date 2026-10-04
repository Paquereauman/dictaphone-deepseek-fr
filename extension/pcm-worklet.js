/**
 * AudioWorklet de capture : convertit le flux micro en PCM 16 bits signe et
 * l'envoie par blocs.
 *
 * ATTENTION : `process()` est appele pour chaque quantum de rendu, soit
 * 128 echantillons (~8 ms a 16 kHz). Poster a chaque appel noierait le passage
 * de messages sous ~8000 messages/seconde. On accumule donc jusqu'a 2048
 * echantillons (128 ms) avant d'envoyer.
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
          const out = this.block.slice(0); // copie : le buffer part au thread principal
          this.port.postMessage(out.buffer, [out.buffer]);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
