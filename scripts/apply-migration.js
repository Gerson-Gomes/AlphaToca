const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  try {
    await p.$executeRawUnsafe(`ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "property_id" TEXT`);
    console.log('1. Added property_id column');

    await p.$executeRawUnsafe(`
      ALTER TABLE "chat_sessions" 
      ADD CONSTRAINT IF NOT EXISTS "chat_sessions_property_id_fkey" 
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") 
      ON DELETE SET NULL ON UPDATE CASCADE
    `).catch(() => console.log('FK already exists'));
    console.log('2. Added foreign key');

    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "chat_sessions_property_id_idx" ON "chat_sessions"("property_id")`).catch(() => {});
    console.log('3. Added index');

    console.log('\n✅ Migration applied successfully');
  } catch (e) {
    console.error(e.message);
  }
  await p.$disconnect();
})();
