## Areas: feature slices / product domains (WHAT)
- broker-dataset       # central brokers.json schema, broker records, URL templates, optout channels
- profile              # raw/derived field model, also_known_as, derivation purity rule
- matching-overlay     # content script DOM reading, deterministic matcher, on-page confirm/clear/skip
- opt-out-drafts       # .eml / instruction-card generation, draft gate logic, channel selection
- coverage-report      # hits store, outcomes (hit|clear|unknown|skipped), fan-out counting
- run-model            # background script, paced tab-batching, content-script/background messaging
- permissions          # optional per-domain host permissions, runtime consent, <all_urls> avoidance

## Topics: cross-cutting technical concerns (HOW)
- webextensions        # Firefox WebExtensions API, MV2/MV3 manifest, AMO distribution
- typescript           # primary language for all extension code
- data-model           # schema design, field shape, status/verified axes, kind safety field
- security-signing     # Ed25519 dual-key, TRUSTED_PUBKEYS, crypto.subtle.verify, key rotation
- dataset-distribution # bundled baseline + signed remote update layer, no-store-review path
- privacy              # local-first design, no telemetry, withhold-by-default ID posture
- verification         # per-channel verified/unverified/broken lifecycle, stale tracking, draft gate
- ux                   # information architecture, navigation, section states, interaction model
- local-llm            # local LLM integration (Ollama), field discovery, localhost CORS, model selection
- licensing            # per-component license model (GPL/AGPL/ODbL), copyleft, repo/LICENSE structure, contributor terms