"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = void 0;
const db_1 = __importDefault(require("../config/db"));
exports.userService = {
    async getAllUsers() {
        return await db_1.default.user.findMany({
            orderBy: { createdAt: 'desc' }
        });
    },
    async getUserById(id) {
        return await db_1.default.user.findUnique({
            where: { id }
        });
    },
    async getUserByFirebaseUid(firebaseUid) {
        return await db_1.default.user.findUnique({
            where: { firebaseUid }
        });
    },
    async createUser(data) {
        return await db_1.default.user.create({
            data
        });
    },
    async updateUser(id, data) {
        try {
            return await db_1.default.user.update({
                where: { id },
                data
            });
        }
        catch (error) {
            return null; // User not found
        }
    },
    async updateUserStatus(id, payload) {
        try {
            return await db_1.default.user.update({
                where: { id },
                data: {
                    status: payload.status,
                    ...(payload.suspendedUntil !== undefined
                        ? { suspendedUntil: payload.suspendedUntil ? new Date(payload.suspendedUntil) : null }
                        : {}),
                },
            });
        }
        catch (error) {
            return null;
        }
    },
    async deleteUser(id) {
        try {
            await db_1.default.user.delete({
                where: { id }
            });
            return true;
        }
        catch (error) {
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
    async upsertUserFromFirebase(firebasePayload) {
        const uid = firebasePayload.uid;
        if (typeof uid !== 'string' || uid.length === 0) {
            throw new Error('Firebase payload is missing the "uid" claim.');
        }
        const name = firebasePayload.name || (firebasePayload.email ? firebasePayload.email.split('@')[0] : 'Unknown');
        const email = firebasePayload.email;
        const phoneNumber = firebasePayload.phone_number;
        const rolesClaim = firebasePayload.roles || firebasePayload.role;
        const roles = Array.isArray(rolesClaim)
            ? rolesClaim.map((r) => String(r).toUpperCase())
            : typeof rolesClaim === 'string' ? [rolesClaim.toUpperCase()] : null;
        let mappedRole;
        if (roles) {
            if (roles.includes('ADMIN'))
                mappedRole = 'ADMIN';
            else if (roles.includes('LANDLORD'))
                mappedRole = 'LANDLORD';
            else
                mappedRole = 'TENANT';
        }
        const placeholderPhone = `pending:${uid}`;
        // 1. Try to find user by firebaseUid
        const existingByUid = await db_1.default.user.findUnique({
            where: { firebaseUid: uid },
        });
        if (existingByUid) {
            const updateData = {
                name,
                ...(email && { email }),
                ...(mappedRole && { role: mappedRole }),
            };
            if (phoneNumber) {
                // Check if another user (from WhatsApp) already has this phone
                const phoneOwner = await db_1.default.user.findUnique({
                    where: { phoneNumber },
                });
                if (phoneOwner && phoneOwner.id !== existingByUid.id) {
                    // Merge: delete the WhatsApp duplicate, then update the Firebase user
                    await db_1.default.user.delete({ where: { id: phoneOwner.id } });
                }
                updateData.phoneNumber = phoneNumber;
            }
            return db_1.default.user.update({
                where: { firebaseUid: uid },
                data: updateData,
            });
        }
        // 2. If phoneNumber is provided, try to find user by phone
        // (created by WhatsApp worker without firebaseUid yet).
        if (phoneNumber) {
            const existingByPhone = await db_1.default.user.findUnique({
                where: { phoneNumber },
            });
            if (existingByPhone) {
                return db_1.default.user.update({
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
        return db_1.default.user.create({
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
