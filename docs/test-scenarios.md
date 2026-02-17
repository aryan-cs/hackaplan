# Test Scenarios

## Automated (Implemented)

1. URL normalization and domain validation (`backend/tests/unit/test_url_utils.py`)
2. Gallery and project page parsing (`backend/tests/unit/test_parser.py`)
3. IP-based rate limits (`backend/tests/unit/test_rate_limit.py`)
4. End-to-end backend job lifecycle with mocked scraper (`backend/tests/integration/test_lookup_flow.py`)

## Manual E2E (Frontend + Backend)

1. Submit valid Devpost hackathon URL and verify:
   - status moves `queued` -> `started` -> `completed`
   - websocket progress events appear live
   - winner cards render with prizes, team, built-with, links, and sections

2. Submit invalid URL and verify client-side validation blocks request.

3. Trigger backend rate limit by repeated lookup creation and verify 429 error is shown.

4. Stop backend mid-lookup and verify frontend shows failure state and supports retry/new lookup.

5. Confirm websocket disconnect state appears when backend is unavailable.
6. Snapshot hit case:
   - ensure a shard exists in `frontend/public/snapshots`
   - search matching hackathon and confirm cards render before live lookup completes
   - confirm live completion replaces snapshot payload.
7. Snapshot miss case:
   - search hackathon not in manifest and confirm existing live-only behavior remains unchanged.
