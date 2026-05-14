import { PrismaClient } from '@prisma/client';
import {
  generateUsers,
  // generateProperties,
  generateChatSessions,
  generateMessages,
  generateKnowledgeDocuments,
} from './generators';
import { demoUsers, demoProperties, demoPropertyImages } from './demoData';

import prisma from '../src/config/db';

export async function main() {
  console.log('Starting seed...');

  // 1. Clean up database
  console.log('Clearing database...');
  await prisma.message.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.rentalDocument.deleteMany().catch(() => { });
  await prisma.aiExtractedInsight.deleteMany().catch(() => { });
  await prisma.rentalProcess.deleteMany().catch(() => { });
  await prisma.visit.deleteMany().catch(() => { });
  await prisma.propertyImage.deleteMany();
  await prisma.property.deleteMany();
  await prisma.user.deleteMany();
  await prisma.knowledgeDocument.deleteMany();

  // 2. Generate and insert Users
  console.log('Generating Users...');
  const randomUsers = generateUsers(48);
  const users = [...demoUsers, ...randomUsers];
  await prisma.user.createMany({ data: users });

  const landlordIds = users.filter((u) => u.role === 'LANDLORD').map((u) => u.id);
  const tenantIds = users.filter((u) => u.role === 'TENANT').map((u) => u.id);

  // Fallbacks in case random generation didn't produce enough
  if (landlordIds.length === 0) landlordIds.push(users[0].id);
  if (tenantIds.length === 0) tenantIds.push(users[0].id);

  // 3. Generate and insert Properties
  console.log('Inserting Demo Properties...');
  await prisma.property.createMany({ data: demoProperties });

  console.log('Inserting Property Images...');
  await prisma.propertyImage.createMany({ data: demoPropertyImages });

  // 4. Generate and insert Chat Sessions
  console.log('Generating Chat Sessions...');
  const sessions = generateChatSessions(200, tenantIds);
  await prisma.chatSession.createMany({ data: sessions });

  // 5. Generate and insert Messages
  console.log('Generating Messages...');
  const sessionIds = sessions.map((s) => s.id);
  const messages = generateMessages(1000, sessionIds);
  await prisma.message.createMany({ data: messages });

  // 6. Generate and insert Knowledge Documents with embeddings
  console.log('Generating Knowledge Documents...');
  const docs = generateKnowledgeDocuments(20);
  for (const doc of docs) {
    const embeddingString = `[${doc.embedding.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "knowledge_documents" (id, title, content, embedding, source_path, chunk_index, content_hash, updated_at) VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8)`,
      doc.id,
      doc.title,
      doc.content,
      embeddingString,
      doc.sourcePath,
      doc.chunkIndex,
      doc.contentHash,
      new Date()
    );
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
      await prisma.$disconnect();
    });
}
