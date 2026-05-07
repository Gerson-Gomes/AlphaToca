const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // Link some WAITING_HUMAN sessions to demo properties
  const sessions = await p.chatSession.findMany({
    where: { status: 'WAITING_HUMAN', propertyId: null },
    take: 6,
  });

  const properties = await p.property.findMany({ take: 3 });

  if (sessions.length === 0 || properties.length === 0) {
    console.log('No sessions or properties found');
    await p.$disconnect();
    return;
  }

  for (let i = 0; i < Math.min(sessions.length, properties.length * 2); i++) {
    const session = sessions[i];
    const property = properties[Math.floor(i / 2)];
    await p.chatSession.update({
      where: { id: session.id },
      data: { propertyId: property.id },
    });
    console.log(`Linked session ${session.id.substring(0,8)}... → property ${property.title.substring(0,30)}... (landlord: ${property.landlordId.substring(0,8)}...)`);
  }

  // Verify landlord filter
  const landlordSessions = await p.chatSession.findMany({
    where: {
      status: 'WAITING_HUMAN',
      property: { landlordId: 'user-demo-landlord-1' },
    },
    include: {
      tenant: { select: { name: true } },
      property: { select: { title: true } },
    },
  });
  console.log(`\n=== Landlord WAITING_HUMAN sessions: ${landlordSessions.length} ===`);
  landlordSessions.forEach(s => console.log(`  ${s.tenant.name} → ${s.property?.title}`));

  await p.$disconnect();
  console.log('\nDone!');
})();
