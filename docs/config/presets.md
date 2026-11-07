# Locale Presets

Mirror Mate supports locale-based configuration presets that automatically apply region-specific settings when you switch languages. This allows you to change just one setting (`app.locale`) and have time zones, weather locations, speech recognition language, clock settings and the voice all update accordingly.

## How It Works

When you set `app.locale` in `config/app.yaml`, Mirror Mate automatically loads the corresponding preset from `config/presets/{locale}.yaml` and applies those settings to features, plugins, and providers.

```
config/app.yaml          ->  config/presets/{locale}.yaml
     |                              |
   locale: "ja"  ---------->  presets/ja.yaml (Tokyo, Japanese STT, etc.)
   locale: "en"  ---------->  presets/en.yaml (US settings, English STT, etc.)
```

## Quick Start

To switch between Japanese and English:

```yaml
# config/app.yaml
app:
  locale: "en"  # Change to "ja" for Japanese
```

That's it! The following settings are automatically applied:

| Setting | Japanese (ja) | English (en) |
|---------|--------------|--------------|
| Timezone | Asia/Tokyo | America/Los_Angeles |
| Weather Locations | Tokyo, Osaka | San Francisco, New York |
| Clock Format | 24-hour | 12-hour |
| STT Language | ja / ja-JP | en / en-US |
| Voice | Sarah | Sarah |

## Preset File Structure

Each preset file (`config/presets/{locale}.yaml`) contains locale-specific defaults:

```yaml
# config/presets/en.yaml

# Time feature settings
time:
  timezone: "America/Los_Angeles"

# Weather feature settings
weather:
  locations:
    - name: "San Francisco"
      latitude: 37.7749
      longitude: -122.4194
    - name: "New York"
      latitude: 40.7128
      longitude: -74.0060
  defaultLocation: "San Francisco"

# Clock plugin settings
clock:
  timezone: "America/Los_Angeles"
  format24h: false
  locale: "en-US"

# Speech-to-Text settings
stt:
  language: "en"  # ISO 639-1

# Text-to-Speech settings: the ElevenLabs voice until one is picked on /control, unless
# providers.yaml sets tts.elevenlabs.voiceId
tts:
  voiceId: "EXAVITQu4vr4xnSDxMaL"  # Sarah
```

## Available Presets

### Japanese (ja)

Default settings for Japanese users:

| Category | Setting | Value |
|----------|---------|-------|
| Time | timezone | Asia/Tokyo |
| Weather | locations | Tokyo, Osaka |
| Weather | defaultLocation | Tokyo |
| Clock | format24h | true |
| Clock | locale | ja-JP |
| STT | language | ja |
| TTS | voiceId | `EXAVITQu4vr4xnSDxMaL` (Sarah) |

### English (en)

Default settings for English (US) users:

| Category | Setting | Value |
|----------|---------|-------|
| Time | timezone | America/Los_Angeles |
| Weather | locations | San Francisco, New York |
| Weather | defaultLocation | San Francisco |
| Clock | format24h | false |
| Clock | locale | en-US |
| STT | language | en |
| TTS | voiceId | `EXAVITQu4vr4xnSDxMaL` (Sarah) |

### German (de)

Default settings for German users:

| Category | Setting | Value |
|----------|---------|-------|
| Time | timezone | Europe/Berlin |
| Weather | locations | Berlin, München |
| Weather | defaultLocation | Berlin |
| Clock | format24h | true |
| Clock | locale | de-DE |
| STT | language | de |
| TTS | voiceId | `XrExE9yKIg1WjnnlVkGX` (Matilda) |

German uses Matilda because ElevenLabs hasn't verified Sarah for German. `GET /v2/voices` lists the languages each voice is verified for under `verified_languages`.

## Customizing Presets

You can customize preset files to match your specific needs:

### Example: European English User

```yaml
# config/presets/en.yaml (customized)

time:
  timezone: "Europe/London"

weather:
  locations:
    - name: "London"
      latitude: 51.5074
      longitude: -0.1278
    - name: "Paris"
      latitude: 48.8566
      longitude: 2.3522
  defaultLocation: "London"

clock:
  timezone: "Europe/London"
  format24h: true  # Europeans often prefer 24-hour
  locale: "en-GB"

stt:
  language: "en"
```

## Override Behavior

Preset values serve as defaults that can be overridden in individual config files:

1. **features.yaml** - If you explicitly set `timezone` in `features.time`, it takes precedence over the preset
2. **plugins.yaml** - If you explicitly set clock settings, they take precedence
3. **providers.yaml** - If you explicitly set STT language or `tts.elevenlabs.voiceId`, it takes precedence
4. **`/control`** - A voice picked there takes precedence over both the preset and `providers.yaml`

### Example: Override Weather Location

```yaml
# config/features.yaml
features:
  weather:
    enabled: true
    # This overrides the preset's locations
    locations:
      - name: "My City"
        latitude: 40.0
        longitude: -100.0
    defaultLocation: "My City"

  time:
    enabled: true
    # timezone is not set, so preset value is used
```

## Creating New Presets

To add support for a new locale:

1. Create a new preset file:

```yaml
# config/presets/fr.yaml (French example)

time:
  timezone: "Europe/Paris"

weather:
  locations:
    - name: "Paris"
      latitude: 48.8566
      longitude: 2.3522
  defaultLocation: "Paris"

clock:
  timezone: "Europe/Paris"
  format24h: true
  locale: "fr-FR"

stt:
  language: "fr"

tts:
  voiceId: "..."  # a voice that GET /v2/voices lists French for under verified_languages
```

2. Add the locale to `LOCALES` in `src/lib/app/index.ts`:

```typescript
export const LOCALES = ["en", "ja", "de", "fr"] as const;
```

3. Add an `fr` entry to every table of server text keyed by locale (`Record<Locale, ...>`). `bun run build` fails, naming each one, until they all have it:
   - `defaultPresets` in `src/lib/presets/index.ts`
   - the character prompt in `src/lib/character/index.ts`, and the camera hint in `src/app/api/chat/route.ts`
   - the time, weather and calendar text in `src/lib/features/`
   - the tool descriptions and results in `src/lib/tools/`
   - `contextLabels` in `src/lib/rules/engine.ts` and `wikipediaSettings` in `src/lib/rules/modules.ts`

4. Create locale-specific character and message files in `config/locales/fr/` and `messages/fr.json`, and add the messages to `src/i18n/messages.test.ts`. That test and `src/lib/app/locales.test.ts` check that they have the same keys, files, rules, modules and characters as English.

5. Choose rule keywords as whole phrases: they match anywhere in what's said, and a match turns the LLM's tools off. Test the wake phrase in that language with local Whisper first, as German's "Hey Mira" came back as "Herr Emira".

## Related Configuration

- [Features](features.md) - Weather, time, calendar settings
- [Plugins](plugins.md) - Clock widget settings
- [Providers](providers.md) - STT provider settings
- [Character](character.md) - AI personality per locale
