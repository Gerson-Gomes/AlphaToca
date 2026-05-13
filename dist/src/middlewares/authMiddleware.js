"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.authSyncMiddleware = exports.checkJwt = exports.validateAuthConfig = void 0;
const userService_1 = require("../services/userService");
const logger_1 = require("../config/logger");
const firebase_1 = __importDefault(require("../config/firebase"));
/**
 * Validates that required Firebase environment variables are set.
 * Should be called at application startup.
 */
const validateAuthConfig = () => {
    const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`[Auth] Missing required Firebase environment variables: ${missing.join(', ')}. ` +
            `Check your .env file.`);
    }
    logger_1.logger.info('[auth] Firebase Auth configuration validated successfully');
};
exports.validateAuthConfig = validateAuthConfig;
/**
 * Authorization middleware using Firebase Admin SDK.
 * Expects 'Authorization: Bearer <token>' in the request headers.
 */
const checkJwt = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                status: 401,
                code: 'UNAUTHORIZED',
                messages: [{ message: 'Missing or invalid Authorization header.' }]
            });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await firebase_1.default.auth().verifyIdToken(token);
        // Attach the decoded token to the request for the next middleware
        req.auth = { payload: decodedToken };
        next();
    }
    catch (error) {
        logger_1.logger.error({ err: error }, '[auth] token verification failed');
        return res.status(401).json({
            status: 401,
            code: 'UNAUTHORIZED',
            messages: [{ message: 'Invalid token.' }]
        });
    }
};
exports.checkJwt = checkJwt;
/**
 * Middleware to synchronize user data from Firebase to our local database.
 * Must be used after checkJwt. Attaches the local user to req.localUser.
 */
const authSyncMiddleware = async (req, res, next) => {
    try {
        const authData = req.auth;
        if (!authData?.payload) {
            return res.status(401).json({
                status: 401,
                code: 'UNAUTHORIZED',
                messages: [{ message: 'Missing authentication payload.' }]
            });
        }
        const user = await userService_1.userService.upsertUserFromFirebase(authData.payload);
        req.localUser = user;
        next();
    }
    catch (error) {
        logger_1.logger.error({ err: error }, '[auth-sync] error syncing user');
        next(error);
    }
};
exports.authSyncMiddleware = authSyncMiddleware;
/**
 * Middleware factory to enforce role-based access control.
 * Must be used after authSyncMiddleware (which attaches localUser).
 */
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        const localUser = req.localUser;
        if (!localUser) {
            return res.status(403).json({
                status: 403,
                code: 'FORBIDDEN',
                messages: [{ message: 'User profile not found. Access denied.' }]
            });
        }
        if (!allowedRoles.includes(localUser.role)) {
            return res.status(403).json({
                status: 403,
                code: 'FORBIDDEN',
                messages: [{ message: `Role '${localUser.role}' is not authorized. Required: ${allowedRoles.join(', ')}` }]
            });
        }
        next();
    };
};
exports.requireRole = requireRole;
