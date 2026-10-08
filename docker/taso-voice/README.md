# Taso Local Voice Service

Self-hosted neural/local TTS lane for Taso. The browser never talks directly to this service; Taso Core proxies status and synthesis through `/v1/voice/local*`.

## Engine order

1. Paid Realtime voice, only when explicitly enabled and allowed.
2. Taso Local Voice, when this service is reachable and at least one production-cleared voice pack is installed.
3. Browser/device TTS as the final fallback.

No external TTS API key is required for the local lane.

## Voice packs

Mount a persistent directory to `/voices` and place:

- `voices.json`
- each Piper-compatible `.onnx` model
- matching `.onnx.json` config

Start from `voices.example.json`. A pack is exposed only when:

- model and config files exist,
- `commercialAllowed` is explicitly `true`,
- the files resolve inside `/voices`.

This prevents a downloaded research/non-commercial model from silently becoming a production Taso voice.

## Male / female profiles

Male and female selections are separate real voice packs. Do not create a fake gender switch by changing pitch. Use voice recordings/models whose usage rights are owned by Tasarlayalım or explicitly allow the intended commercial use.

## Licensing boundary

Do not bundle a model merely because the inference code is open source. The voice model and training dataset can have different licenses. Store the actual license identifier in `voices.json` and verify commercial/redistribution rights before setting `commercialAllowed: true`.

At the time this lane was introduced, the currently published official Turkish Piper `dfki` model card points to a CC BY-NC-SA dataset, and Coqui XTTS-v2 uses the Coqui Public Model License for non-commercial use. They are therefore not auto-bundled here.

## Core configuration

Set on Taso Core:

```env
TASO_LOCAL_VOICE_URL=http://taso-voice:8000
TASO_LOCAL_VOICE_TIMEOUT_MS=20000
```

Keep the voice service on the private/internal network. It does not need to be public.

## Health

`GET /health` returns only production-cleared and physically present packs.

`POST /synthesize` accepts:

```json
{
  "text": "Buradayım. Sistemler normal.",
  "voiceId": "taso-signature-male",
  "speed": 0.9
}
```

and returns `audio/wav`.
