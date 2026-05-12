import { Role, User, UserStatus } from '@prisma/client';
import prisma from '../config/db';

export const userService = {
  async getAllUsers(): Promise<User[]> {
    return await prisma.user.findMany({
      orderBy: { createdAt: 'desc' }
    });
  },

  async getUserById(id: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { id }
    });
  },

  async getUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { firebaseUid }
    });
  },

  async createUser(data: { name: string; email: string; phoneNumber: string; role: Role }): Promise<User> {
    return await prisma.user.create({
      data
    });
  },

  async updateUser(id: string, data: Partial<{ name: string; email: string; phoneNumber: string; role: Role; fcmToken: string }>): Promise<User | null> {
    try {
      return await prisma.user.update({
        where: { id },
        data
      });
    } catch (error) {
      return null; // User not found
    }
  },

  async updateUserStatus(
    id: string,
    payload: { status: UserStatus; suspendedUntil?: string | null; reason?: string | null },
  ): Promise<User | null> {
    try {
      return await prisma.user.update({
        where: { id },
        data: {
          status: payload.status,
          ...(payload.suspendedUntil !== undefined
            ? { suspendedUntil: payload.suspendedUntil ? new Date(payload.suspendedUntil) : null }
            : {}),
        },
      });
    } catch (error) {
      return null;
    }
  },

  async deleteUser(id: string): Promise<boolean> {
    try {
      await prisma.user.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      return false; // User not found
    }
  },

  /**
   * Upsert a user from Firebase Auth JWT payload.
   *
   * Handles the "WhatsApp first, register later" scenario: if a user with
   * the same phoneNumber already exists (created by the WhatsApp worker
   * without firebaseUid), links the firebaseUid to that existing record
   * instead of creating a duplicate.
   *
   * Also handles the reverse: if the Firebase user already exists with a
   * placeholder phone and a real phone is provided, migrates the phone and
   * merges with any WhatsApp-created user that already owns that phone.
   */
  async upsertUserFromFirebase(firebasePayload: any): Promise<User> {
    const uid = firebasePayload.uid;
    if (typeof uid !== 'string' || uid.length === 0) {
      throw new Error('Firebase payload is missing the "uid" claim.');
    }

    const name = (firebasePayload.name as string) || (firebasePayload.email ? firebasePayload.email.split('@')[0] : 'Unknown');
    const email = firebasePayload.email as string | undefined;
    const phoneNumber = firebasePayload.phone_number as string | undefined;

    const rolesClaim = firebasePayload.roles || firebasePayload.role;
    const roles = Array.isArray(rolesClaim)
      ? rolesClaim.map((r: string) => String(r).toUpperCase())
      : typeof rolesClaim === 'string' ? [rolesClaim.toUpperCase()] : null;

    let mappedRole: Role | undefined;
    if (roles) {
      if (roles.includes('ADMIN')) mappedRole = 'ADMIN';
      else if (roles.includes('LANDLORD')) mappedRole = 'LANDLORD';
      else mappedRole = 'TENANT';
    }

    const placeholderPhone = `pending:${uid}`;

    // 1. Try to find user by firebaseUid
    const existingByUid = await prisma.user.findUnique({
      where: { firebaseUid: uid },
    });

    if (existingByUid) {
      const updateData: any = {
        name,
        ...(email && { email }),
        ...(mappedRole && { role: mappedRole }),
      };

      if (phoneNumber) {
        // Check if another user (from WhatsApp) already has this phone
        const phoneOwner = await prisma.user.findUnique({
          where: { phoneNumber },
        });

        if (phoneOwner && phoneOwner.id !== existingByUid.id) {
          // Merge: delete the WhatsApp duplicate, then update the Firebase user
          await prisma.user.delete({ where: { id: phoneOwner.id } });
        }

        updateData.phoneNumber = phoneNumber;
      }

      return prisma.user.update({
        where: { firebaseUid: uid },
        data: updateData,
      });
    }

    // 2. If phoneNumber is provided, try to find user by phone
    // (created by WhatsApp worker without firebaseUid yet).
    if (phoneNumber) {
      const existingByPhone = await prisma.user.findUnique({
        where: { phoneNumber },
      });

      if (existingByPhone) {
        return prisma.user.update({
          where: { id: existingByPhone.id },
          data: {
            firebaseUid: uid,
            name,
            ...(email && { email }),
            ...(mappedRole && { role: mappedRole }),
          },
        });
      }
    }

    // 3. No existing user found — create new
    return prisma.user.create({
      data: {
        firebaseUid: uid,
        name,
        email,
        phoneNumber: phoneNumber || placeholderPhone,
        role: mappedRole ?? 'TENANT',
      },
    });
  }
};
