export const TAPE_NAME = 'moa-tape';

/**
 * The tape recorder's audio thread, as worklet source text: a stereo input (no output) whose samples go to the page
 * in chunks of a second or so, while it is recording. `start` begins a take; `stop` sends what is left and `done`.
 */
export const TAPE_SOURCE = `
if (typeof registerProcessor === 'function') {
  class MoaTape extends AudioWorkletProcessor {
    constructor() {
      super();
      this.recording = false;
      this.size = 32768;
      this.fresh();
      this.port.onmessage = (e) => {
        if (e.data.type === 'start') { this.fresh(); this.recording = true; }
        else if (e.data.type === 'stop') { this.recording = false; this.send(); this.port.postMessage({ type: 'done' }); }
      };
    }
    fresh() { this.L = new Float32Array(this.size); this.R = new Float32Array(this.size); this.at = 0; }
    send() {
      if (!this.at) return;
      const L = this.L.slice(0, this.at), R = this.R.slice(0, this.at);
      this.port.postMessage({ type: 'chunk', L, R }, [L.buffer, R.buffer]);
      this.fresh();
    }
    process(inputs) {
      const input = inputs[0];
      if (!this.recording || !input || !input.length) return true;
      const l = input[0], r = input[1] || input[0];
      for (let i = 0; i < l.length; i++) {
        this.L[this.at] = l[i]; this.R[this.at] = r[i];
        if (++this.at === this.size) this.send();
      }
      return true;
    }
  }
  registerProcessor('${TAPE_NAME}', MoaTape);
}
`;
