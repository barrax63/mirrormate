// Records what the page does with replies in Web Audio. Loaded as is, like fake-mic.js.
// Only the contexts that play a reply count: each recording has its own, for volume analysis.
window.__audioContexts = [];

const { createMediaElementSource } = AudioContext.prototype;

AudioContext.prototype.createMediaElementSource = function (...args) {
  if (!window.__audioContexts.includes(this)) window.__audioContexts.push(this);
  return createMediaElementSource.apply(this, args);
};

// Connections made minus nodes disconnected. The page connects a source and an analyser
// for each reply, and disconnects both when it ends.
const { connect, disconnect } = AudioNode.prototype;
window.__audioLinks = 0;

AudioNode.prototype.connect = function (...args) {
  if (window.__audioContexts.includes(this.context)) window.__audioLinks++;
  return connect.apply(this, args);
};

AudioNode.prototype.disconnect = function (...args) {
  if (window.__audioContexts.includes(this.context)) window.__audioLinks--;
  return disconnect.apply(this, args);
};
