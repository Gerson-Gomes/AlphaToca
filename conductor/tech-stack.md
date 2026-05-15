# Technology Stack

## Core Technologies
- **Language:** TypeScript
- **Runtime:** Node.js
- **Framework:** Express

## Data Layer
- **Database:** PostgreSQL with `pgvector`
- **ORM:** Prisma

## Identity & Security
- **Provider:** Auth0
- **Standard:** JSON Web Tokens (JWT)

## Background Processing & Queues
- **Queue Engine:** Redis
- **Job Manager:** BullMQ
- **Rationale:** This is mandatory to handle WhatsApp Cloud API webhooks. It guarantees an immediate HTTP 200 OK response to the WhatsApp hub while offloading the heavy LLM/RAG processing with LangChain to the background.

## AI & RAG Components
- **Orchestration:** LangChain (Node.js)
- **Vector Store:** PostgreSQL (`pgvector`)

## Communication & Messaging
- **Integration:** WhatsApp Cloud API (Direct)
