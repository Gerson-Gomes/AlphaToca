const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const users = await p.user.findMany({
    select: { id: true, name: true, phoneNumber: true, firebaseUid: true, role: true }
  });
  console.log('=== USERS ===');
  users.forEach(u => console.log(`  ${u.role.padEnd(10)} | ${u.name.padEnd(25)} | phone: ${u.phoneNumber} | firebaseUid: ${u.firebaseUid?.substring(0,20) ?? '(null)'} | id: ${u.id.substring(0,8)}...`));

  const props = await p.property.findMany({
    select: { id: true, title: true, city: true, price: true, landlordId: true }
  });
  console.log('\n=== PROPERTIES ===');
  props.forEach(p => console.log(`  ${p.title.padEnd(40)} | ${p.city} | R$${p.price} | landlord: ${p.landlordId.substring(0,8)}...`));

  console.log('\n=== CHAT SESSIONS ===');
  const sessions = await p.chatSession.findMany({
    select: { id: true, tenantId: true, propertyId: true, status: true }
  });
  sessions.forEach(s => console.log(`  ${s.id.substring(0,8)}... tenant=${s.tenantId.substring(0,8)}... property=${s.propertyId?.substring(0,8)??'none'} status=${s.status}`));

  await p.$disconnect();
})();
