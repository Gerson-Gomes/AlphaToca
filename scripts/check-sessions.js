const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const s = await p.chatSession.findMany({
    where: { tenantId: '5eaa937f-3441-487b-9ece-54942a3b2655' },
    include: {
      tenant: { select: { id: true, name: true, phoneNumber: true } },
      _count: { select: { messages: true } },
      messages: { orderBy: { timestamp: 'desc' }, take: 1, select: { content: true, timestamp: true, senderType: true } },
    },
  });
  console.log('Sessions for Flutter user:', s.length);
  s.forEach(x => console.log(`  id=${x.id} status=${x.status} msgs=${x._count.messages} last=${x.messages[0]?.content?.substring(0,50)}`));
  await p.$disconnect();
})();
