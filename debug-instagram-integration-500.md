# Debug Session: instagram-integration-500

Status: OPEN

## Symptom
Instagram Integration page requests return HTTP 500 in production.

## Hypotheses
1. Instagram page-list database query has a schema or column mismatch.
2. JWT user identity or ownership filtering causes a PostgreSQL type mismatch.
3. Required runtime migrations are failing in the production database.
4. Coolify is serving an older backend deployment or has a database/environment connection failure.

## Evidence Plan
Add minimal server-side network instrumentation to the Instagram page-list endpoint, reproduce the request, then inspect the captured error payload before applying a fix.

## Findings
Browser-side debug reporting was blocked by mixed content because the production page is HTTPS and the temporary debug server URL was HTTP.

## Applied Fix Candidate
1. Removed browser debug HTTP reporting from Instagram Integration.
2. Made Instagram runtime schema setup safer by creating minimal required tables before ALTER statements.
3. Frontend now shows backend error response JSON instead of only generic toast.

## Verification
Local checks passed:
- node --check backend/src/routes/instagramRoutes.js
- npm run build
