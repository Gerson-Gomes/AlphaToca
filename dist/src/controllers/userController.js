"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userController = void 0;
const userService_1 = require("../services/userService");
const userValidation_1 = require("../utils/userValidation");
exports.userController = {
    /**
     * GET /api/users/me
     * Returns the authenticated user's profile from the local database.
     */
    async getMe(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Authenticated user profile not found in database.' }]
                });
            }
            return res.status(200).json(localUser);
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * PATCH /api/users/me/fcm-token
     * Updates the authenticated user's FCM token.
     */
    async updateFcmToken(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Authenticated user profile not found in database.' }]
                });
            }
            const { fcmToken } = req.body;
            if (!fcmToken || typeof fcmToken !== 'string') {
                return res.status(400).json({
                    status: 400,
                    code: 'BAD_REQUEST',
                    messages: [{ message: 'fcmToken is required and must be a string.' }]
                });
            }
            const updatedUser = await userService_1.userService.updateUser(localUser.id, { fcmToken });
            return res.status(200).json(updatedUser);
        }
        catch (error) {
            next(error);
        }
    },
    async updateMe(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Authenticated user profile not found in database.' }]
                });
            }
            const validatedData = userValidation_1.UserUpdateMeSchema.parse(req.body);
            if (Object.keys(validatedData).length === 0) {
                return res.status(400).json({
                    status: 400,
                    code: 'BAD_REQUEST',
                    messages: [{ message: 'No valid fields to update. Provide phoneNumber and/or role.' }]
                });
            }
            const updatedUser = await userService_1.userService.updateUser(localUser.id, validatedData);
            return res.status(200).json(updatedUser);
        }
        catch (error) {
            next(error);
        }
    },
    async getAll(req, res, next) {
        try {
            const users = await userService_1.userService.getAllUsers();
            return res.status(200).json(users);
        }
        catch (error) {
            next(error);
        }
    },
    async getById(req, res, next) {
        try {
            const { id } = req.params;
            const user = await userService_1.userService.getUserById(id);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.status(200).json(user);
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const validatedData = userValidation_1.UserSchema.parse(req.body);
            const newUser = await userService_1.userService.createUser(validatedData);
            return res.status(201).json(newUser);
        }
        catch (error) {
            next(error);
        }
    },
    async update(req, res, next) {
        try {
            const { id } = req.params;
            const validatedData = userValidation_1.UserUpdateSchema.parse(req.body);
            const user = await userService_1.userService.updateUser(id, validatedData);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.status(200).json(user);
        }
        catch (error) {
            next(error);
        }
    },
    async delete(req, res, next) {
        try {
            const { id } = req.params;
            const success = await userService_1.userService.deleteUser(id);
            if (!success) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.status(204).send();
        }
        catch (error) {
            next(error);
        }
    },
    async updateStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { status, suspendedUntil, reason } = req.body;
            if (!status || !['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
                return res.status(400).json({
                    status: 400,
                    code: 'VALIDATION_ERROR',
                    messages: [{ message: 'status must be ACTIVE, SUSPENDED, or BANNED' }],
                });
            }
            const user = await userService_1.userService.updateUserStatus(id, { status, suspendedUntil, reason });
            if (!user) {
                return res.status(404).json({
                    status: 404,
                    code: 'USER_NOT_FOUND',
                    messages: [{ message: `User ${id} not found.` }],
                });
            }
            return res.status(200).json(user);
        }
        catch (error) {
            next(error);
        }
    }
};
