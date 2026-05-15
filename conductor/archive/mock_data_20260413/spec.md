# Track Specification: Mock Data Generation Script

## Overview
Create a mock data generation script to populate the PostgreSQL database with realistic mock data for development and testing purposes. The script will be integrated directly into Prisma's native seeding mechanism (`prisma db seed`) and will leverage Faker.js to generate massive amounts of randomized data.

## Functional Requirements
- **Prisma Seeding:** Integrate the script to be executable via `npx prisma db seed`.
- **Faker.js Integration:** Utilize `@faker-js/faker` to generate randomized, realistic data.
- **Entity Generation:** 
  - **Users:** Generate mock tenants, landlords, and real estate agents.
  - **Properties:** Generate realistic property listings (descriptions, prices, attributes) linked to landlords.
  - **Messages:** Generate realistic WhatsApp chat histories to simulate past interactions linked to users.
  - **Vector Embeddings:** Generate mock embeddings for properties and FAQs to support `pgvector` RAG testing.
- **Relational Integrity:** Ensure related entities are created in the correct sequential order (e.g., Users -> Properties -> Messages -> Embeddings).

## Non-Functional Requirements
- **Performance:** Use bulk inserts (`createMany`) where possible to efficiently populate large amounts of data.
- **Idempotency:** The script should include logic to clear or reset the database state before seeding to prevent duplication errors during repeated runs.

## Acceptance Criteria
- The script is triggered successfully via the standard `npx prisma db seed` command.
- The database is populated with a robust dataset of mock Users, Properties, Messages, and Vector Embeddings.
- Generated data appears realistic (valid formats, descriptive text).
- Required packages (like `@faker-js/faker`) are added as devDependencies.
- `package.json` contains the correct `prisma.seed` configuration.

## Out of Scope
- Modifying the core `schema.prisma` definition (only utilizing existing models).
- Calling a real LLM API for embedding generation (mock embeddings will be generated as random vectors matching the required dimensions).