# Track Specification: Implement JWT and Auth0 Authentication

## Overview
This track focuses on integrating Auth0 as the primary identity provider for the AlphaToca backend. It involves securing Express routes using JWT validation and managing user synchronization between Auth0 and the local PostgreSQL database.

## Functional Requirements
- Integrate \`express-oauth2-jwt-bearer\` middleware for JWT validation.
- Support Email/Password and Social (Google/Apple) authentication methods via Auth0.
- Implement an automated user onboarding flow:
    - Auto-create users in the \`users\` table upon their first successful Auth0 login.
    - Synchronize user profile information (name, phone number) from Auth0 to the database on every login.
- Map Auth0 roles to the existing Prisma \`Role\` enum using custom claims in the JWT.
- Securely retrieve user information from the validated JWT for use in backend logic.

## Non-Functional Requirements
- **Security:** Ensure all sensitive routes require a valid JWT.
- **Reliability:** Gracefully handle synchronization failures without blocking authentication.
- **Maintainability:** Use standard Auth0 libraries and patterns.

## Acceptance Criteria
- [ ] Unauthorized requests to protected routes return a 401 status.
- [ ] Requests with valid Auth0 JWTs are permitted.
- [ ] New users are correctly created in the database after their first login.
- [ ] User roles are correctly identified from the JWT custom claims.
- [ ] User profile updates in Auth0 are reflected in the local database.

## Out of Scope
- Management of Auth0 tenant configuration (this spec assumes Auth0 is already configured).
- Frontend implementation (Mobile or Web).
