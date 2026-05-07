const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // 1. Merge: move all sessions from WhatsApp user to Flutter user
  const waUser = await p.user.findUnique({ where: { phoneNumber: '556798032925' } });
  const appUser = await p.user.findUnique({ where: { firebaseUid: 'mMnJsKY5LLQf3kI03FdJ9Sk653B3' } });

  if (!waUser || !appUser) {
    console.log('Users not found');
    await p.$disconnect();
    return;
  }

  console.log(`WhatsApp user: ${waUser.id} (phone: ${waUser.phoneNumber})`);
  console.log(`Flutter user:  ${appUser.id} (phone: ${appUser.phoneNumber})`);

  // Move all sessions to the Flutter user
  const result = await p.chatSession.updateMany({
    where: { tenantId: waUser.id },
    data: { tenantId: appUser.id },
  });
  console.log(`Moved ${result.count} sessions to Flutter user`);

  // Delete related records before deleting user
  await p.rentalProcess.deleteMany({ where: { tenantId: waUser.id } });
  await p.aiExtractedInsight.deleteMany({ where: { rentalProcess: { tenantId: waUser.id } } });
  await p.message.deleteMany({ where: { session: { tenantId: waUser.id } } });
  await p.chatSession.deleteMany({ where: { tenantId: waUser.id } });

  // Delete the duplicate WhatsApp user
  await p.user.delete({ where: { id: waUser.id } });
  console.log('Deleted duplicate WhatsApp user');

  // Update Flutter user phone to match WhatsApp format (without +)
  await p.user.update({
    where: { id: appUser.id },
    data: { phoneNumber: '556798032925' },
  });
  console.log('Updated Flutter user phone to: 556798032925');

  console.log('\n✅ Merge complete!');
  await p.$disconnect();
})();
