const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const waUser = await p.user.findUnique({ where: { phoneNumber: '556798032925' } });
  const appUser = await p.user.findUnique({ where: { firebaseUid: 'mMnJsKY5LLQf3kI03FdJ9Sk653B3' } });

  if (!waUser) { console.log('WhatsApp user already deleted'); await p.$disconnect(); return; }

  console.log(`Cleaning up WhatsApp user: ${waUser.id}`);

  // Order matters: child tables first
  const rps = await p.rentalProcess.findMany({ where: { tenantId: waUser.id }, select: { id: true } });
  for (const rp of rps) {
    await p.aiExtractedInsight.deleteMany({ where: { rentalProcessId: rp.id } });
  }
  console.log(`  aiExtractedInsights cleaned`);

  await p.rentalProcess.deleteMany({ where: { tenantId: waUser.id } });
  console.log(`  rentalProcesses deleted`);

  const sessions = await p.chatSession.findMany({ where: { tenantId: waUser.id }, select: { id: true } });
  for (const s of sessions) {
    await p.message.deleteMany({ where: { sessionId: s.id } });
  }
  console.log(`  messages cleaned`);

  await p.chatSession.deleteMany({ where: { tenantId: waUser.id } });
  console.log(`  chatSessions deleted`);

  await p.user.delete({ where: { id: waUser.id } });
  console.log(`  user deleted`);

  if (appUser) {
    await p.user.update({ where: { id: appUser.id }, data: { phoneNumber: '556798032925' } });
    console.log(`  Flutter user phone updated to: 556798032925`);
  }

  console.log('\n✅ Cleanup complete! Mesmo user para WhatsApp e Flutter.');
  await p.$disconnect();
})();
