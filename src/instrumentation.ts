// Runs once when the server starts
export async function register() {
  // next dev also builds this file for the edge runtime, where fs can't be resolved. The imports
  // must stay inside this block, which that build drops: after an early return, it still bundles
  // them, and the failed build then answers every route with a 500.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // The voice selector shows the account's voices as they were at start
    const { listVoices } = await import("./lib/tts/elevenlabs");
    const { loadProvidersConfig } = await import("./lib/providers/config-loader");
    listVoices(loadProvidersConfig().providers?.tts?.elevenlabs)
      .then((voices) => console.log(`[Voices] Loaded ${voices.length} ElevenLabs voices`))
      .catch((error) => console.warn("[Voices] Couldn't load ElevenLabs voices, trying again when asked:", error.message));
  }
}
