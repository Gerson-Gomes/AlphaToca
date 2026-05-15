# Initial Concept
a mobile app for renting apartments, Whatsapp integration using RAG. This repository only covers the backend side of the project, it's an api written in typescript and running on nodeJS

# Product Definition

## Vision
A backend API for a mobile rental platform that leverages WhatsApp as a primary lead generation and qualification tool, which seamlessly transitions users to a mobile/web app for more detailed property discovery.

## Target Audience
- **Tenants:** Searching for apartments and interacting via WhatsApp for initial inquiries.
- **Landlords/Managers:** Managing listings and applications initiated via automated WhatsApp leads.
- **Real Estate Agents:** Automating the first point of contact and lead filtering.

## Core Value Proposition
- **WhatsApp Entry Point:** Serving as the initial interaction layer for client engagement.
- **Automated FAQ & Qualification:** Using RAG to answer initial queries and qualify leads on WhatsApp.
- **Frictionless Transition:** Directing qualified leads from WhatsApp to the mobile/web application for rich property exploration and final applications.

## Key Features
- **WhatsApp Webhook:** Processing incoming messages and providing AI-powered responses.
- **Property Listing API:** Powering the mobile/web app for comprehensive property queries.
- **RAG System:** Using PostgreSQL with `pgvector` for intelligent response generation on WhatsApp.

## Essential Integrations
- **WhatsApp API:** For initial communication and lead intake.
- **PostgreSQL with pgvector:** Serving as the primary database and vector store for RAG.
