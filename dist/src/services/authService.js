"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = void 0;
const firebase_1 = __importDefault(require("../config/firebase"));
const userService_1 = require("./userService");
const logger_1 = require("../config/logger");
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || '';
const identityToolkitUrl = (endpoint) => `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FIREBASE_API_KEY}`;
exports.authService = {
    async register(params) {
        const { name, email, password, phone, isOwner } = params;
        const firebaseUser = await firebase_1.default.auth().createUser({
            email,
            password,
            displayName: name,
            phoneNumber: phone,
        });
        const uid = firebaseUser.uid;
        if (isOwner) {
            await firebase_1.default.auth().setCustomUserClaims(uid, { role: 'LANDLORD' });
        }
        const upsertPayload = {
            uid,
            name,
            email,
            phone_number: phone,
            role: isOwner ? 'LANDLORD' : 'TENANT',
        };
        const localUser = await userService_1.userService.upsertUserFromFirebase(upsertPayload);
        const customToken = await firebase_1.default.auth().createCustomToken(uid);
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
    async login(email, password) {
        if (!FIREBASE_API_KEY) {
            throw new Error('FIREBASE_API_KEY is not configured. Please add it to your .env file (find it in Firebase Console > Project Settings > General > Web API Key).');
        }
        let uid;
        let displayName;
        let phoneNumber;
        let localRole;
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
            const data = (await response.json());
            if (!response.ok || data.error) {
                const message = data?.error?.message
                    ?.replace('EMAIL_NOT_FOUND', 'Email not registered')
                    ?.replace('INVALID_PASSWORD', 'Invalid password')
                    ?.replace('INVALID_LOGIN_CREDENTIALS', 'Invalid credentials')
                    ?.replace('USER_DISABLED', 'Account disabled')
                    ?.replace(/_/g, ' ') || 'Login failed';
                throw new Error(message);
            }
            uid = data.localId;
            displayName = data.displayName;
            const firebaseUser = await firebase_1.default.auth().getUser(uid);
            const customClaims = firebaseUser.customClaims || {};
            phoneNumber = firebaseUser.phoneNumber;
            localRole = customClaims.role;
        }
        catch (error) {
            if (error.message && !error.message.includes('http')) {
                throw error;
            }
            logger_1.logger.error({ err: error }, '[authService] Firebase REST login failed');
            throw new Error('Authentication failed. Please try again.');
        }
        const upsertPayload = {
            uid,
            name: displayName,
            email,
            phone_number: phoneNumber,
            role: localRole ?? 'TENANT',
        };
        const localUser = await userService_1.userService.upsertUserFromFirebase(upsertPayload);
        const customToken = await firebase_1.default.auth().createCustomToken(uid);
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
