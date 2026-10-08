# Taso Local Neural Voice

Self-hosted Turkish neural speech for Taso. The browser never talks directly to this service; Taso Core proxies status and synthesis through `/v1/voice/local*`.

## Engine order

1. Paid Realtime voice, only when explicitly enabled and allowed.
2. **Taso Local Neural — FreyaTTS-small**.
3. Browser/device TTS only as the last fallback.

The local lane requires no external TTS API key and has no per-request API fee.

## Engine

Default engine: `freyavoice/freya-tts` (FreyaTTS-small).

FreyaTTS-small is Turkish-first, self-hosted and released under Apache-2.0. The Docker image pins the upstream source commit for reproducible builds. Model weights are fetched from Hugging Face on first runtime load and then remain in the mounted/cache layer.

Runtime variables:

```env
TASO_FREYA_MODEL=freyavoice/freya-tts
TASO_FREYA_DEVICE=cpu
TASO_FREYA_STEPS=32
```

Use `cuda` only when the Coolify host has a compatible GPU runtime.

## Taso voice profiles

FreyaTTS selects a deterministic voice using a seed. The canonical upstream Leyla voice uses seed `9`, so the built-in `Taso Signature Kadın` profile uses that seed.

Other seeds generate different deterministic people. They must be auditioned before receiving a gender/character label. Taso therefore includes neutral candidate seeds for Voice Lab testing rather than falsely labelling an unverified seed as male.

To lock a chosen male/female Taso voice, mount `/voices/voices.json` based on `voices.example.json` and set:

- stable `id`
- visible `label`
- verified `gender`
- chosen `seed`
- `license`
- `commercialAllowed: true`
- `character`

The UI exposes only profiles returned by this service.

## Licensing boundary

Do not assume that open inference code makes every downloadable voice model commercially usable. FreyaTTS-small code and weights are Apache-2.0 and are therefore the default production-safe engine in this lane.

Older candidates investigated during development were intentionally not bundled: the current official Turkish Piper `dfki` model card references a CC BY-NC-SA dataset, while Coqui XTTS-v2 uses the Coqui Public Model License for non-commercial use.

## Core configuration

Set on Taso Core:

```env
TASO_LOCAL_VOICE_URL=http://taso-voice:8000
TASO_LOCAL_VOICE_TIMEOUT_MS=20000
```

Keep this service private/internal; it does not need a public domain.

## Health

`GET /health` reports:

- model loading/readiness
- engine/model/device
- synthesis steps
- license
- available deterministic Taso profiles

`POST /synthesize` accepts:

```json
{
  "text": "Buradayım. Sistemler normal. Seni dinliyorum.",
  "voiceId": "taso-signature-female",
  "speed": 0.9
}
```

and returns 48 kHz `audio/wav`.
