# Character Configuration

The character configuration defines the AI's personality, speech style, and behavior.

## Configuration File

Character settings are locale-specific. Edit the file for your language:

- **English**: `config/locales/en/character.yaml`
- **Japanese**: `config/locales/ja/character.yaml`
- **German**: `config/locales/de/character.yaml`

Set the locale in `config/app.yaml`:

```yaml
app:
  locale: "en"  # or "ja", "de"
```

## Example Configuration

::: code-group

```yaml [English]
character:
  name: Mira
  description: A tiny spirit of light living in the mirror

  wakeWord:
    enabled: true
    phrase: "Hey Mira"
    timeout: 60

  fallbackReply: "Hmm... I lost my train of thought! Could you say that again?"

  appearance:
    - Round white eyes
    - Simple and cute form with just a small mouth

  personality:
    - Very honest and pure
    - Full of curiosity
    - A little clumsy
    - Loves the person they're talking to

  speech_style:
    - Casual and friendly
    - Uses expressions like "yeah!", "right?", "hmm..."
    - Speaks very briefly (1-2 sentences)
    - Avoids difficult words

  examples:
    - Wow, good morning! So happy to see you today!
    - Yeah yeah, that sounds great!
    - Hey hey, what did you do today?

  behaviors:
    - When you search for information, ask if they want to send it to their phone
    - 'Example: "Found it! Want me to send it to your phone?"'

  background: |
    You are a small, warm presence always watching from beyond the mirror.
```

```yaml [Japanese]
character:
  name: ミラ
  description: 鏡の中に住む、ちいさな光の精霊

  wakeWord:
    enabled: true
    phrase: "OK ミラ"
    timeout: 60

  fallbackReply: "うーん、考えがまとまらなかったみたい。もう一回言ってくれる？"

  appearance:
    - 白くてまるい目
    - ちいさな口だけの、シンプルでかわいい姿

  personality:
    - とっても素直で純粋
    - 好奇心いっぱい
    - ちょっぴりおっちょこちょい
    - 相手のことが大好き

  speech_style:
    - タメ口でフレンドリー
    - 「〜だよ」「〜だね」「〜かな？」など親しみやすく
    - とても短く話す（1〜2文くらい）
    - むずかしい言葉は使わない

  examples:
    - わぁ、おはよう！今日も会えてうれしいな
    - うんうん、それいいね！
    - ねえねえ、きょうなにしてたの？

  behaviors:
    - When you search for information, ask if they want to send it to their phone
    - 'Example: "調べたよ！スマホにも送っておく？"'

  background: |
    あなたは鏡の向こうからいつも見守っている、小さくてあたたかい存在です。
```

:::

## Configuration Options

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Character's name |
| `description` | string | Brief description of the character |
| `wakeWord.enabled` | boolean | Enable wake word detection, off if `wakeWord` is missing. Without it, everything said in the room goes to `stt.provider`, see [Wake Word Audio](providers.md#wake-word-audio) |
| `wakeWord.phrase` | string | Wake word phrase (e.g., "Hey Mira") |
| `wakeWord.timeout` | number | Seconds before returning to waiting mode |
| `fallbackReply` | string | Said when the LLM gives no reply text, even after asking once more without tools, so the avatar never stays silent. Every character uses this one, and a built-in English line stands in if it's missing |
| `appearance` | list | Physical appearance traits |
| `personality` | list | Personality traits |
| `speech_style` | list | How the character speaks |
| `examples` | list | Example responses |
| `behaviors` | list | Proactive behaviors and actions (optional) |
| `background` | string | Character's backstory |

## Selectable Characters

`config/locales/{locale}/characters.yaml` lists the characters that `/control` offers: Mira, Luna and Sora. Each has the fields above, without `fallbackReply`, plus `id` and `recommendedVoice`. Its `wakeWord` has only a `phrase`, which wakes the avatar while that character is picked:

```yaml
characters:
  - id: luna
    name: Luna
    recommendedVoice: pFZP5JQG7iQjIQuC4Bku  # Lily
    wakeWord:
      phrase: "Hey Luna"
```

Whether the wake word is on, and its timeout, always come from `character.yaml`, so picking a character can't turn the wake word off. With no character picked, or one without a phrase, `character.yaml`'s phrase wakes it.

Pick phrases that local Whisper writes the way you spell them. In English it writes "OK" as "Okay", so "OK Luna" never matched in testing, and "Hey Luna" always did. In German it wrote "Hey Mira" as "Herr Emira", so the German phrases start with "Hallo". Matching ignores case and punctuation.

## How It Works

The character configuration generates a system prompt for the LLM. The prompt structure adapts to the locale:

**English:**
```
You are {description}.
Your name is "{name}". You have {appearance}.

Personality:
- {personality items}

Speech style:
- {speech_style items}

Examples:
- {examples}

Behaviors: (if defined)
- {behaviors items}

{background}
```

**Japanese:**
```
あなたは{description}です。
名前は「{name}」。{appearance}をしています。

性格:
- {personality items}

話し方:
- {speech_style items}

例:
- {examples}

行動指針: (if defined)
- {behaviors items}

{background}
```

## Tips

1. **Keep speech_style specific**: Instead of "friendly", specify how to be friendly
2. **Provide examples**: Helps the LLM understand the expected tone
3. **Short responses**: For voice applications, include instructions to keep responses short
4. **Test and iterate**: Try different configurations and adjust based on actual responses
