"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const authService_1 = require("../services/authService");
const logger_1 = require("../config/logger");
exports.authController = {
    /**
     * POST /api/auth/register
     * Public endpoint. Creates a user in Firebase Auth, syncs to local DB,
     * and returns a Firebase custom token for immediate authentication.
     */
    async register(req, res, next) {
        try {
            const { name, email, password, phone, isOwner } = req.body;
            if (!name || !email || !password || !phone) {
                return res.status(400).json({
                    status: 400,
                    code: 'BAD_REQUEST',
                    messages: [{ message: 'Missing required fields: name, email, password, phone.' }],
                });
            }
            const result = await authService_1.authService.register({
                name,
                email,
                password,
                phone,
                isOwner: !!isOwner,
            });
            return res.status(201).json(result);
        }
        catch (error) {
            if (error?.code?.startsWith('auth/')) {
                const message = error.message || 'Registration failed';
                return res.status(409).json({
                    status: 409,
                    code: 'CONFLICT',
                    messages: [{ message }],
                });
            }
            logger_1.logger.error({ err: error }, '[authController] register failed');
            next(error);
        }
    },
    /**
     * POST /api/auth/login
     * Public endpoint. Verifies credentials via Firebase Auth REST API,
     * syncs user to local DB, and returns a Firebase custom token.
     */
    async login(req, res, next) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({
                    status: 400,
                    code: 'BAD_REQUEST',
                    messages: [{ message: 'Missing required fields: email, password.' }],
                });
            }
            const result = await authService_1.authService.login(email, password);
            return res.status(200).json(result);
        }
        catch (error) {
            if (error.message?.includes('Invalid') ||
                error.message?.includes('not registered') ||
                error.message?.includes('disabled')) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: error.message }],
                });
            }
            logger_1.logger.error({ err: error }, '[authController] login failed');
            next(error);
        }
    },
    /**
     * GET /api/auth/me
     * Protected endpoint (uses checkJwt + authSyncMiddleware).
     * Returns the authenticated user's profile.
     */
    async me(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'User profile not found.' }],
                });
            }
            return res.status(200).json({
                id: localUser.id,
                name: localUser.name,
                email: localUser.email,
                phone: localUser.phoneNumber,
                role: localUser.role,
                isOwner: localUser.role === 'LANDLORD',
            });
        }
        catch (error) {
            next(error);
        }
    },
};
