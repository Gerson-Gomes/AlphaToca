# Implementation Plan: JWT and Auth0 Authentication

## Phase 1: Foundation & Infrastructure [checkpoint: 71df7f3]
- [x] Task: Install and configure authentication dependencies (bb600df)
    - [x] Add \`express-oauth2-jwt-bearer\` and \`jwks-rsa\` to package.json
    - [x] Define required Auth0 environment variables in \`.env.example\`
- [x] Task: Conductor - User Manual Verification 'Foundation & Infrastructure' (Protocol in workflow.md)

## Phase 2: Auth Middleware Implementation (TDD) [checkpoint: a22b10b]
- [x] Task: Create JWT validation middleware (a67edf2)
    - [x] **Red:** Write tests to verify 401 response for missing/invalid tokens
    - [x] **Green:** Implement middleware using \`auth()\` from express-oauth2-jwt-bearer
    - [x] **Refactor:** Clean up middleware structure and error handling
- [x] Task: Conductor - User Manual Verification 'Auth Middleware Implementation' (Protocol in workflow.md)

## Phase 3: User Synchronization & Identity Management (TDD) [checkpoint: 37fa387]
- [x] Task: Implement user synchronization service (2c46f99)
    - [x] **Red:** Write tests for \`upsertUserFromAuth0\` (creation and update)
    - [x] **Green:** Implement service logic to sync profile data and roles
    - [x] **Refactor:** Optimize Prisma queries and role mapping logic
- [x] Task: Integrate synchronization into the request lifecycle (c1162e4)
    - [x] **Red:** Write tests to ensure user exists in DB after authenticated request
    - [x] **Green:** Add sync logic to the auth middleware or a separate wrapper
- [x] Task: Conductor - User Manual Verification 'User Synchronization & Identity Management' (Protocol in workflow.md)

## Phase 4: Route Security & Integration [checkpoint: 519f4de]
- [x] Task: Secure existing application routes (4c686e6)
    - [x] **Red:** Write integration tests for \`/api/properties\` and \`/api/users\` expecting 401
    - [x] **Green:** Apply auth middleware to all routes in \`src/server.ts\` or individual routers
- [x] Task: Conductor - User Manual Verification 'Route Security & Integration' (Protocol in workflow.md)
