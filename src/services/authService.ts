import admin from '../config/firebase';
import { userService } from './userService';
import { logger } from '../config/logger';

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';

const identityToolkitUrl = (endpoint: string) =>
  `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FIREBASE_API_KEY}`;

export const authService = {
  async register(params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    isOwner: boolean;
  }) {
    const { name, email, password, phone, isOwner } = params;

    const firebaseUser = await admin.auth().createUser({
      email,
      password,
      displayName: name,
      phoneNumber: phone,
    });

    const uid = firebaseUser.uid;

    if (isOwner) {
      await admin.auth().setCustomUserClaims(uid, { role: 'LANDLORD' });
    }

    const upsertPayload = {
      uid,
      name,
      email,
      phone_number: phone,
      role: isOwner ? 'LANDLORD' : 'TENANT',
    };
    const localUser = await userService.upsertUserFromFirebase(upsertPayload);

    const customToken = await admin.auth().createCustomToken(uid);

    return {
      token: customToken,
      user: {
        id: localUser.id,
        name: localUser.name,
        email: localUser.email,
        phone: localUser.phoneNumber,
        role: localUser.role,
      },
    };
  },

  async login(email: string, password: string) {
    if (!FIREBASE_API_KEY) {
      throw new Error(
        'FIREBASE_API_KEY is not configured. Please add it to your .env file (find it in Firebase Console > Project Settings > General > Web API Key).'
      );
    }

    let uid: string;
    let displayName: string | undefined;
    let phoneNumber: string | undefined;
    let localRole: string | undefined;

    try {
      const response = await fetch(identityToolkitUrl('signInWithPassword'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      });

      const data = (await response.json()) as any;

      if (!response.ok || data.error) {
        const message =
          data?.error?.message
            ?.replace('EMAIL_NOT_FOUND', 'Email not registered')
            ?.replace('INVALID_PASSWORD', 'Invalid password')
            ?.replace('INVALID_LOGIN_CREDENTIALS', 'Invalid credentials')
            ?.replace('USER_DISABLED', 'Account disabled')
            ?.replace(/_/g, ' ') || 'Login failed';
        throw new Error(message);
      }

      uid = data.localId;
      displayName = data.displayName;

      const firebaseUser = await admin.auth().getUser(uid);
      const customClaims = firebaseUser.customClaims || {};

      phoneNumber = firebaseUser.phoneNumber;
      localRole = customClaims.role as string | undefined;
    } catch (error: any) {
      if (error.message && !error.message.includes('http')) {
        throw error;
      }
      logger.error({ err: error }, '[authService] Firebase REST login failed');
      throw new Error('Authentication failed. Please try again.');
    }

    const upsertPayload = {
      uid,
      name: displayName,
      email,
      phone_number: phoneNumber,
      role: localRole ?? 'TENANT',
    };
    const localUser = await userService.upsertUserFromFirebase(upsertPayload);

    const customToken = await admin.auth().createCustomToken(uid);

    return {
      token: customToken,
      user: {
        id: localUser.id,
        name: localUser.name,
        email: localUser.email,
        phone: localUser.phoneNumber,
        role: localUser.role,
      },
    };
  },
};
