# Taso Speaker Recognition

Optional internal speaker-recognition worker for conversational personalization.

## Security boundary

Speaker matching is **not authentication**. A successful voice match may change how Taso addresses the speaker or which conversational profile is loaded, but it must never grant access to secrets, roles, approvals, deployments, production writes, billing or account controls. Those continue to use the authenticated Taso session and deterministic authorization policies.

## Runtime

Build this directory as its own private/internal Coolify resource. Give `/data` a persistent volume.

Required environment:

```env
PORT=3200
TASO_SPEAKER_SERVICE_SECRET=<long-random-secret>
TASO_SPEAKER_DATA_DIR=/data
```

On Taso Core configure the matching connection:

```env
TASO_SPEAKER_SERVICE_URL=http://<internal-speaker-service>:3200
TASO_SPEAKER_SERVICE_SECRET=<same-secret>
TASO_SPEAKER_CONFIDENCE_MIN=0.82
```

Do not expose the speaker service publicly. Enrollment stores voice embeddings in `/data/profiles.json`; raw audio is decoded in a temporary directory and is not persisted. Multiple enrollment samples are averaged to improve stability.

The service uses Resemblyzer embeddings and cosine similarity. The confidence threshold is intentionally enforced again by Taso Core so the worker cannot elevate its own authority.
