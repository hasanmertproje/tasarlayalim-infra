# Taso Realtime Voice

Taso has two voice engines behind one UI:

1. **Browser fallback (default)** — browser SpeechRecognition + SpeechSynthesis, no separate Realtime API spend.
2. **Realtime WebRTC (optional)** — low-latency duplex audio with semantic VAD and barge-in.

## Safety and cost gates

Realtime is **OFF by default**. It is ready only when all three conditions are true:

- `TASO_VOICE_REALTIME_ENABLED=true`
- `TASO_VOICE_REALTIME_PAID_ALLOWED=true`
- a server-side `TASO_VOICE_REALTIME_API_KEY` (or `OPENAI_API_KEY`) is configured

The standard API key stays inside Taso Core. It is never returned to the browser.

If any gate is missing, the UI automatically keeps using the browser voice fallback.

## Runtime environment

```env
TASO_VOICE_REALTIME_ENABLED=false
TASO_VOICE_REALTIME_PAID_ALLOWED=false
TASO_VOICE_REALTIME_API_KEY=
TASO_VOICE_REALTIME_MODEL=gpt-realtime-2.1-mini
TASO_VOICE_REALTIME_VOICE=marin
TASO_VOICE_REALTIME_BASE_URL=https://api.openai.com
TASO_VOICE_SAFETY_SALT=
```

Do not commit API keys to GitHub. Configure them only in the protected runtime environment.

## Browser flow

1. UI checks `GET /v1/voice/realtime`.
2. When Realtime is ready, the browser opens the microphone with echo cancellation/noise suppression.
3. Browser creates a WebRTC offer.
4. Taso Core receives the SDP through `POST /v1/voice/realtime/session`.
5. Taso Core creates the provider-side Realtime call with its server-side credential and returns only the SDP answer.
6. Audio flows over WebRTC; JSON Realtime events use the `oai-events` data channel.
7. If bootstrap fails or Realtime is disabled, UI falls back to the browser STT/TTS engine.

## Turkish conversation profile

Realtime sessions are configured for:

- natural Istanbul Turkish only,
- a calm, controlled, concise Taso persona,
- Turkish input transcription,
- semantic VAD,
- automatic response creation,
- automatic response interruption when the operator starts speaking,
- audio output plus live transcripts in the UI.

## Chat is not Mission

The Realtime model has **no repository, CI, deployment, deletion, billing or access-management tools**.

Voice transcripts are separately passed to the deterministic Taso intent classifier:

- normal chat/question/status/planning: no mission proposal,
- execution language: UI may display a mission proposal,
- no proposal is executed automatically,
- a mission is created only after the operator explicitly presses `Mission oluştur`,
- existing HIGH_IMPACT approval rules remain authoritative after mission creation.

This boundary is covered by automated tests.

## Operational notes

- Realtime session bootstrap is rate-limited per workspace.
- A privacy-preserving safety identifier can be derived from workspace ID when `TASO_VOICE_SAFETY_SALT` is configured.
- Realtime failures must not break voice entirely; browser voice remains the fallback.
- Do not enable the paid lane merely because the code is deployed. Enabling spend is a separate operational decision.
