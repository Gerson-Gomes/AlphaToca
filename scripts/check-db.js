const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const users = await p.user.findMany({
    select: { id: true, name: true, phoneNumber: true, firebaseUid: true, role: true }
  });
  console.log('=== USERS ===');
  users.forEach(u => console.log(JSON.stringify(u)));

  const sessions = await p.chatSession.findMany({
    include: {
      tenant: { select: { id: true, name: true, phoneNumber: true } },
      _count: { select: { messages: true } }
    }
  });
  console.log('\n=== SESSIONS ===');
  sessions.forEach(s => console.log(JSON.stringify({
    id: s.id,
    tenantId: s.tenantId,
    tenantName: s.tenant.name,
    tenantPhone: s.tenant.phoneNumber,
    status: s.status,
    msgCount: s._count.messages
  })));

  await p.$disconnect();
})();
