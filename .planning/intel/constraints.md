# Constraints Intel

Technical constraints, NFRs, and contracts extracted from classified SPECs.

---

## From `conductor/tracks/auth_jwt_auth0_20260416/spec.md` (SPEC, high confidence)

Source SPEC title: "Track Specification: Implement JWT and Auth0 Authentication"

### CONSTRAINT-auth0-identity-provider
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: protocol
- scope: authentication, identity management
- content:
  - Auth0 is the primary identity provider for the AlphaToca backend.
  - Supported authentication methods: Email/Password and Social (Google/Apple) via Auth0.
  - Auth0 tenant configuration is assumed pre-existing and out of scope for this spec.

### CONSTRAINT-jwt-validation-middleware
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: api-contract
- scope: request authentication
- content:
  - Use `express-oauth2-jwt-bearer` middleware for JWT validation on Express routes.
  - All sensitive routes must require a valid JWT; unauthorized requests return HTTP 401.
  - Requests with valid Auth0 JWTs must be permitted.
  - User information is retrieved from the validated JWT for use in backend logic.

### CONSTRAINT-user-sync-on-login
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: protocol
- scope: user onboarding, user profile synchronization
- content:
  - On a user's first successful Auth0 login, auto-create a row in the `users` table.
  - On every subsequent login, synchronize profile information (name, phone number) from Auth0 to the local database.
  - Synchronization failures must be handled gracefully without blocking authentication (reliability NFR).

### CONSTRAINT-role-mapping-from-jwt-custom-claims
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: schema
- scope: authorization, role-based access
- content:
  - Auth0 roles are mapped to the existing Prisma `Role` enum via custom claims embedded in the JWT.
  - User roles must be correctly identifiable from the JWT custom claims.

### CONSTRAINT-auth-acceptance-tests
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: api-contract
- scope: authentication, regression testing
- content: Acceptance criteria from the SPEC, restated as integration-level contract:
  - Unauthorized requests to protected routes return HTTP 401.
  - Requests with valid Auth0 JWTs are permitted.
  - New users are correctly created in the database after their first login.
  - User roles are correctly identified from JWT custom claims.
  - User profile updates in Auth0 are reflected in the local database.

### NFR-auth-security
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: nfr
- scope: security
- content: Ensure all sensitive routes require a valid JWT.

### NFR-auth-reliability
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: nfr
- scope: reliability
- content: Gracefully handle Auth0-to-DB synchronization failures without blocking authentication.

### NFR-auth-maintainability
- source: `conductor/tracks/auth_jwt_auth0_20260416/spec.md`
- type: nfr
- scope: maintainability
- content: Use standard Auth0 libraries and patterns (`express-oauth2-jwt-bearer`, `jwks-rsa`) rather than hand-rolled JWT parsing.

### Out of scope for the Auth track
- Management of Auth0 tenant configuration (assumed preconfigured).
- Frontend (Mobile/Web) implementation.

---

## Summary

| count | type | sources |
|-------|------|---------|
| 1 | SPEC | `conductor/tracks/auth_jwt_auth0_20260416/spec.md` |

No API-level OpenAPI schemas, DB migration specs, or wire-protocol contracts were ingested. The roadmapper should note that the auth SPEC is the only formal constraint contract in this corpus — RAG-related technical constraints live in the PRD (FR-1 through FR-14) and have been captured in `requirements.md`.
