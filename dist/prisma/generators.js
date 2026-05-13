"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateKnowledgeDocuments = exports.generateMessages = exports.generateChatSessions = exports.generateProperties = exports.generateUsers = void 0;
const faker_1 = require("@faker-js/faker");
const crypto_1 = require("crypto");
const generateUsers = (count) => {
    return Array.from({ length: count }).map(() => ({
        id: (0, crypto_1.randomUUID)(),
        name: faker_1.faker.person.fullName(),
        phoneNumber: faker_1.faker.phone.number(),
        role: faker_1.faker.helpers.arrayElement(['TENANT', 'LANDLORD', 'ADMIN']),
        createdAt: faker_1.faker.date.past(),
    }));
};
exports.generateUsers = generateUsers;
const generateProperties = (count, landlordIds) => {
    return Array.from({ length: count }).map(() => ({
        id: (0, crypto_1.randomUUID)(),
        landlordId: faker_1.faker.helpers.arrayElement(landlordIds),
        title: faker_1.faker.lorem.words(3),
        description: faker_1.faker.lorem.paragraph(),
        price: faker_1.faker.number.float({ min: 1000, max: 15000, fractionDigits: 2 }),
        status: faker_1.faker.helpers.arrayElement(['AVAILABLE', 'NEGOTIATING', 'RENTED']),
        address: faker_1.faker.location.streetAddress(),
        city: faker_1.faker.location.city(),
        state: faker_1.faker.location.state({ abbreviated: true }),
        zipCode: faker_1.faker.location.zipCode(),
        type: faker_1.faker.helpers.arrayElement(['APARTMENT', 'HOUSE', 'STUDIO', 'CONDO_HOUSE']),
        bedrooms: faker_1.faker.number.int({ min: 1, max: 5 }),
        bathrooms: faker_1.faker.number.int({ min: 1, max: 4 }),
        parkingSpots: faker_1.faker.number.int({ min: 0, max: 3 }),
        area: faker_1.faker.number.float({ min: 30, max: 400, fractionDigits: 1 }),
        isFurnished: faker_1.faker.datatype.boolean(),
        petsAllowed: faker_1.faker.datatype.boolean(),
        latitude: faker_1.faker.location.latitude({ max: -23.4, min: -23.7 }),
        longitude: faker_1.faker.location.longitude({ max: -46.5, min: -46.8 }),
        nearSubway: faker_1.faker.datatype.boolean(),
        isFeatured: faker_1.faker.datatype.boolean({ probability: 0.2 }),
        views: faker_1.faker.number.int({ min: 0, max: 1000 }),
        condoFee: faker_1.faker.number.float({ min: 200, max: 2000, fractionDigits: 2 }),
        propertyTax: faker_1.faker.number.float({ min: 50, max: 500, fractionDigits: 2 }),
    }));
};
exports.generateProperties = generateProperties;
const generateChatSessions = (count, tenantIds) => {
    return Array.from({ length: count }).map(() => ({
        id: (0, crypto_1.randomUUID)(),
        tenantId: faker_1.faker.helpers.arrayElement(tenantIds),
        status: faker_1.faker.helpers.arrayElement(['ACTIVE_BOT', 'WAITING_HUMAN', 'RESOLVED']),
        startedAt: faker_1.faker.date.past(),
    }));
};
exports.generateChatSessions = generateChatSessions;
const generateMessages = (count, sessionIds) => {
    return Array.from({ length: count }).map(() => ({
        id: (0, crypto_1.randomUUID)(),
        sessionId: faker_1.faker.helpers.arrayElement(sessionIds),
        senderType: faker_1.faker.helpers.arrayElement(['BOT', 'TENANT', 'LANDLORD']),
        content: faker_1.faker.lorem.sentence(),
        mediaUrl: faker_1.faker.datatype.boolean() ? faker_1.faker.image.url() : null,
        timestamp: faker_1.faker.date.recent(),
    }));
};
exports.generateMessages = generateMessages;
const generateKnowledgeDocuments = (count) => {
    return Array.from({ length: count }).map(() => ({
        id: (0, crypto_1.randomUUID)(),
        title: faker_1.faker.lorem.words(4),
        content: faker_1.faker.lorem.paragraphs(2),
        embedding: Array.from({ length: 1536 }).map(() => faker_1.faker.number.float({ min: -1, max: 1 })),
        sourcePath: faker_1.faker.system.filePath(),
        chunkIndex: faker_1.faker.number.int({ min: 0, max: 100 }),
        contentHash: faker_1.faker.string.alphanumeric(32),
    }));
};
exports.generateKnowledgeDocuments = generateKnowledgeDocuments;
