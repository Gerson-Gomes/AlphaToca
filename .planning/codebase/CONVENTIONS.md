# Coding Conventions

**Analysis Date:** 2026-04-25

## Naming Patterns

**Files:**
- Controllers: `{domain}Controller.ts` (e.g., `userController.ts`, `visitController.ts`)
- Services: `{domain}Service.ts` (e.g., `userService.ts`, `visitService.ts`)
- Validation schemas: `{domain}Validation.ts` (e.g., `userValidation.ts`, `visitValidation.ts`)
- Middlewares: `{purpose}Middleware.ts` (e.g., `authMiddleware.ts`, `errorHandler.ts`)
- Config: `{service}.ts` in `src/config/` (e.g., `db.ts`, `swagger.ts`, `langsmith.ts`)
- Routes: `{domain}Routes.ts` (e.g., `userRoutes.ts`, `propertyRoutes.ts`)
- Workers: `{domain}Worker.ts` (e.g., `whatsappWorker.ts`)

**Functions:**
- Exported as properties of an object (e.g., `export const userService = { getAllUsers(...) }`)
- Arrow functions with `async` prefix where needed
- Named exports for individual functions (e.g., `export async function createVisit(...)`)
- camelCase naming: `getAllUsers`, `getUserById`, `createVisit`, `updateVisit`
- Helper functions use descriptive names: `findConflicting`, `overlaps`, `endOf`

**Variables:**
- camelCase for all local variables and constants
- Constants that hold configuration or lookup tables use UPPER_SNAKE_CASE: `MAX_DURATION_MINUTES`, `STATUS_WEIGHT`, `INTENT_VALUES`
- Single-letter loop variables acceptable in tight loops: `for (const c of candidates)`

**Types:**
- PascalCase for interfaces and types: `VisitError`, `VisitDeps`, `FakeProperty`
- Enum-like types from Prisma use PascalCase: `Role`, `VisitStatus`
- Type suffixes indicate purpose:
  - `Input`: validation input types (e.g., `CreateVisitInput`, `UpdateVisitInput`)
  - `Schema`: Zod schema constants (e.g., `createVisitSchema`, `updateVisitSchema`)
  - `Query`: query parameter types (e.g., `ListVisitsQuery`, `AvailabilityQuery`)
  - `Deps`: dependency injection interfaces (e.g., `VisitDeps`)

## Code Style

**Formatting:**
- Indentation: 2 spaces (no tabs)
- Line length: No strict limit, but prefer readability
- No visible linting configuration (eslint/prettier): rely on TypeScript strict mode and manual convention adherence

**Linting:**
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- All compiler options enforce consistency:
  - `esModuleInterop: true` for consistent import handling
  - `skipLibCheck: true` to focus on application code
  - `forceConsistentCasingInFileNames: true` prevents case-sensitivity issues
  - `target: ES2022` for modern JavaScript support

## Import Organization

**Order:**
1. External framework/library imports (e.g., `express`, `zod`, `@prisma/client`)
2. Internal configuration imports (e.g., `prisma from '../config/db'`)
3. Internal service/utility imports (e.g., from `../services/`, `../utils/`)
4. Type-only imports (when used): `import type { ... } from ...`

**Examples:**
```typescript
// Example 1: Controller imports
import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/userService';
import { UserSchema, UserUpdateSchema } from '../utils/userValidation';

// Example 2: Service imports
import { Role, User } from '@prisma/client';
import prisma from '../config/db';
import type { PrismaClient } from '@prisma/client';

// Example 3: Type-heavy service
import type { PrismaClient, Visit, VisitStatus } from '@prisma/client';
import prisma from '../config/db';
import type {
  CreateVisitInput,
  UpdateVisitInput,
  ListVisitsQuery,
  AvailabilityQuery,
} from '../utils/visitValidation';
```

**Path Aliases:**
- No alias configuration detected; use relative paths (`../services/`, `../config/`)

## Error Handling

**Patterns:**
- Custom error classes extend `Error` and add semantic information:
  - `VisitError` has `code` (string), `httpStatus` (number), and optional `details` (object)
  - See `src/services/visitService.ts` lines 12-24 for example

- Error throwing:
  ```typescript
  throw new VisitError('PROPERTY_NOT_FOUND', 404, { propertyId: input.propertyId });
  throw new VisitError('CONFLICT', 409, { conflictWith: conflict.id });
  ```

- Error handling in controllers:
  - Wrap service calls in try-catch
  - Catch domain-specific errors (e.g., `VisitError`) and format responses
  - Pass unknown errors to `next(error)` for centralized error handler

- Centralized error handler in `src/middlewares/errorHandler.ts`:
  - Catches `UnauthorizedError` (from `express-oauth2-jwt-bearer`)
  - Catches `ZodError` for validation failures
  - Catches `SyntaxError` for JSON parse errors
  - Returns consistent error response format: `{ status, code, messages }`

**Return value patterns on error:**
- Services return `null` when resource not found (e.g., `updateUser`, `deleteUser` return `boolean | null`)
- Services throw custom errors for conflict/validation errors
- Controllers catch both and format appropriately

## Logging

**Framework:** `console` (no logging library detected)

**Patterns:**
- Log errors: `console.error('[Error Handler] ${err.name}: ${err.message}')`
- Log info: `console.log('[Auth] Auth0 configuration validated successfully.')`
- Include context prefix in square brackets: `[Auth]`, `[Error Handler]`, `[AuthSync]`
- Log to console; structured logging not implemented
- No log levels beyond error/log; use descriptive prefixes instead

## Comments

**When to Comment:**
- JSDoc comments for public functions explaining purpose, parameters, and side effects
- See `src/services/userService.ts` line 51-57 for Auth0 upsert comment
- See `src/middlewares/authMiddleware.ts` lines 6-21 for function documentation

**JSDoc/TSDoc:**
- Document public functions with JSDoc blocks:
  ```typescript
  /**
   * Upsert a user from Auth0 JWT payload.
   * Uses auth0Sub (the "sub" claim) as the unique identifier for sync.
   * If the user doesn't exist, creates a new one with a UUID id.
   * ...
   */
  async upsertUserFromAuth0(auth0Payload: Record<string, unknown>): Promise<User>
  ```
- No @param/@returns tags observed; inline comments in JSDoc describe behavior
- Inline comments explain non-obvious logic (e.g., `// Back-to-back (aEnd == bStart) NÃO conta como conflito.`)

## Function Design

**Size:** 
- Most functions are 10-50 lines
- Longer functions (100+ lines) are still cohesive (e.g., `userService.upsertUserFromAuth0` handles Auth0 role mapping with clear steps)

**Parameters:**
- Functions accept simple types or a single `input` object to avoid parameter overload
- Dependency injection via optional `deps` parameter with defaults: `deps: VisitDeps = defaultDeps`
- See `src/services/visitService.ts` lines 92-95 for pattern

**Return Values:**
- Async functions return `Promise<T>` or `Promise<T | null>`
- Services return domain objects or `null` on not-found
- Custom errors are thrown, not returned as error results
- Void returns used for middleware and setup functions

## Module Design

**Exports:**
- Controllers: export as single object with methods: `export const userController = { ... }`
- Services: export as single object OR multiple named functions (see `visitService.ts` uses both patterns)
- Utilities: export named types from Zod inference: `export type CreateVisitInput = z.infer<typeof createVisitSchema>`
- Config files: export default (e.g., `export default prisma`, `export const setupSwagger = ...`)

**Barrel Files:**
- Not observed; each import specifies full path

**Cross-file patterns:**
- Validation schemas (Zod) defined in `src/utils/` and imported by both controllers and services
- Custom error types defined in service files where thrown
- Prisma client imported from `src/config/db` throughout codebase
