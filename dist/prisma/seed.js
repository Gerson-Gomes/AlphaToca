"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const generators_1 = require("./generators");
const demoData_1 = require("./demoData");
const db_1 = __importDefault(require("../src/config/db"));
async function main() {
    console.log('Starting seed...');
    // 1. Clean up database
    console.log('Clearing database...');
    await db_1.default.message.deleteMany();
    await db_1.default.chatSession.deleteMany();
    await db_1.default.rentalDocument.deleteMany().catch(() => { });
    await db_1.default.aiExtractedInsight.deleteMany().catch(() => { });
    await db_1.default.rentalProcess.deleteMany().catch(() => { });
    await db_1.default.propertyImage.deleteMany();
    await db_1.default.property.deleteMany();
    await db_1.default.user.deleteMany();
    await db_1.default.knowledgeDocument.deleteMany();
    // 2. Generate and insert Users
    console.log('Generating Users...');
    const randomUsers = (0, generators_1.generateUsers)(48);
    const users = [...demoData_1.demoUsers, ...randomUsers];
    await db_1.default.user.createMany({ data: users });
    const landlordIds = users.filter((u) => u.role === 'LANDLORD').map((u) => u.id);
    const tenantIds = users.filter((u) => u.role === 'TENANT').map((u) => u.id);
    // Fallbacks in case random generation didn't produce enough
    if (landlordIds.length === 0)
        landlordIds.push(users[0].id);
    if (tenantIds.length === 0)
        tenantIds.push(users[0].id);
    // 3. Generate and insert Properties
    console.log('Inserting Demo Properties...');
    await db_1.default.property.createMany({ data: demoData_1.demoProperties });
    console.log('Inserting Property Images...');
    await db_1.default.propertyImage.createMany({ data: demoData_1.demoPropertyImages });
    // 4. Generate and insert Chat Sessions
    console.log('Generating Chat Sessions...');
    const sessions = (0, generators_1.generateChatSessions)(200, tenantIds);
    await db_1.default.chatSession.createMany({ data: sessions });
    // 5. Generate and insert Messages
    console.log('Generating Messages...');
    const sessionIds = sessions.map((s) => s.id);
    const messages = (0, generators_1.generateMessages)(1000, sessionIds);
    await db_1.default.message.createMany({ data: messages });
    // 6. Generate and insert Knowledge Documents with embeddings
    console.log('Generating Knowledge Documents...');
    const docs = (0, generators_1.generateKnowledgeDocuments)(20);
    for (const doc of docs) {
        const embeddingString = `[${doc.embedding.join(',')}]`;
        await db_1.default.$executeRawUnsafe(`INSERT INTO "knowledge_documents" (id, title, content, embedding, source_path, chunk_index, content_hash, updated_at) VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8)`, doc.id, doc.title, doc.content, embeddingString, doc.sourcePath, doc.chunkIndex, doc.contentHash, new Date());
    }
    console.log('Seeding completed successfully.');
}
if (require.main === module) {
    main()
        .catch((e) => {
        console.error(e);
        process.exit(1);
    })
        .finally(async () => {
        await db_1.default.$disconnect();
    });
}
