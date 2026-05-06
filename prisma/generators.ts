import { faker } from '@faker-js/faker';

export const generateUsers = (count: number) => {
  return Array.from({ length: count }).map(() => ({
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    phoneNumber: faker.phone.number(),
    role: faker.helpers.arrayElement(['TENANT', 'LANDLORD', 'ADMIN']),
    createdAt: faker.date.past(),
  }));
};

/*export const generateProperties = (count: number, landlordIds: string[]) => {
  return Array.from({ length: count }).map(() => ({
    id: faker.string.uuid(),
    landlordId: faker.helpers.arrayElement(landlordIds),
    title: faker.lorem.words(3),
    description: faker.lorem.paragraph(),
    price: faker.number.float({ min: 1000, max: 15000, fractionDigits: 2 }),
    status: faker.helpers.arrayElement(['AVAILABLE', 'IN_NEGOTIATION', 'RENTED']),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    zipCode: faker.location.zipCode(),

    // Novos campos para busca e filtros
    type: faker.helpers.arrayElement(['APARTMENT', 'HOUSE', 'STUDIO', 'CONDO_HOUSE']),
    bedrooms: faker.number.int({ min: 1, max: 5 }),
    bathrooms: faker.number.int({ min: 1, max: 4 }),
    parkingSpots: faker.number.int({ min: 0, max: 3 }),
    area: faker.number.float({ min: 30, max: 400, fractionDigits: 1 }),
    isFurnished: faker.datatype.boolean(),
    petsAllowed: faker.datatype.boolean(),
    latitude: faker.location.latitude({ max: -23.4, min: -23.7 }),
    longitude: faker.location.longitude({ max: -46.5, min: -46.8 }),
    nearSubway: faker.datatype.boolean(),
    isFeatured: faker.datatype.boolean({ probability: 0.2 }),
    views: faker.number.int({ min: 0, max: 1000 }),
    condoFee: faker.number.float({ min: 200, max: 2000, fractionDigits: 2 }),
    propertyTax: faker.number.float({ min: 50, max: 500, fractionDigits: 2 }),
  }));
};
*/
export const generateChatSessions = (count: number, tenantIds: string[]) => {
  return Array.from({ length: count }).map(() => ({
    id: faker.string.uuid(),
    tenantId: faker.helpers.arrayElement(tenantIds),
    status: faker.helpers.arrayElement(['ACTIVE_BOT', 'WAITING_HUMAN', 'RESOLVED']),
    startedAt: faker.date.past(),
  }));
};

export const generateMessages = (count: number, sessionIds: string[]) => {
  return Array.from({ length: count }).map(() => ({
    id: faker.string.uuid(),
    sessionId: faker.helpers.arrayElement(sessionIds),
    senderType: faker.helpers.arrayElement(['BOT', 'TENANT', 'LANDLORD']),
    content: faker.lorem.sentence(),
    mediaUrl: faker.datatype.boolean() ? faker.image.url() : null,
    timestamp: faker.date.recent(),
  }));
};

export const generateKnowledgeDocuments = (count: number) => {
  return Array.from({ length: count }).map(() => ({
    id: faker.string.uuid(),
    title: faker.lorem.words(4),
    content: faker.lorem.paragraphs(2),
    embedding: Array.from({ length: 1536 }).map(() => faker.number.float({ min: -1, max: 1 })),
    sourcePath: faker.system.filePath(),
    chunkIndex: faker.number.int({ min: 0, max: 100 }),
    contentHash: faker.string.alphanumeric(32),
  }));
};

