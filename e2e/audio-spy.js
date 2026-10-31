// Records what the page does with Web Audio. Loaded as is, like speech-recognition-stub.js.
const NativeAudioContext = window.AudioContext;
window.__audioContexts = [];

window.AudioContext = class extends NativeAudioContext {
  constructor(...args) {
    super(...args);
    window.__audioContexts.push(this);
  }
};

// Connections made minus nodes disconnected. The page connects a source and an analyser
// for each reply, and disconnects both when it ends.
const { connect, disconnect } = AudioNode.prototype;
window.__audioLinks = 0;

AudioNode.prototype.connect = function (...args) {
  window.__audioLinks++;
  return connect.apply(this, args);
};

AudioNode.prototype.disconnect = function (...args) {
  window.__audioLinks--;
  return disconnect.apply(this, args);
};
