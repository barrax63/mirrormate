// Runs once when the server starts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // The voice selector shows the account's voices as they were at start
  const { listVoices } = await import("./lib/tts/elevenlabs");
  const { loadProvidersConfig } = await import("./lib/providers/config-loader");
  listVoices(loadProvidersConfig().providers?.tts?.elevenlabs)
    .then((voices) => console.log(`[Voices] Loaded ${voices.length} ElevenLabs voices`))
    .catch((error) => console.warn("[Voices] Couldn't load ElevenLabs voices, trying again when asked:", error.message));
}
