# Taso Web Search

Private SearxNG worker used by Taso Web Research for general keyword search. Public URL reading does not depend on this service; this service upgrades Taso from URL-only reading to general web search.

Deploy this directory as an internal Coolify resource. It should not be exposed publicly unless separately secured.

Recommended worker environment:

```env
SEARXNG_SECRET=<long-random-secret>
```

Then configure Taso Core:

```env
TASO_SEARCH_ENDPOINT=http://<internal-search-service>:8080/search
```

Taso Core adds `q=<query>&format=json`, applies its own timeout/cache limits, and treats all returned snippets as untrusted web data rather than instructions.

After configuration, verify:

- `GET /v1/research/status` reports `searchReady: true`.
- `GET /v1/capabilities` reports `web-search` as `ready`.
- A normal conversation such as “internetten güncel olarak araştır” can use the web context without creating a Mission.
