"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const db_1 = __importDefault(require("../config/db"));
exports.notificationService = {
    /**
     * Lists the authenticated user's notifications, newest first.
     *
     * Filters strictly by `userId = owner.id` — no cross-user leak. When
     * `unreadOnly` is true, only notifications with `readAt IS NULL` are
     * returned; otherwise the full history is returned.
     *
     * Ordered by `receivedAt DESC` via the `(user_id, received_at)` index
     * added in migration `20260510000000_extend_notification_for_history`.
     * Limited to 200 rows — the /notifications screen is a history view,
     * not an audit log; older rows roll off the client anyway.
     */
    async listForUser(userId, opts = {}) {
        const where = { userId };
        if (opts.unreadOnly) {
            where.readAt = null;
        }
        const rows = await db_1.default.notification.findMany({
            where,
            orderBy: { receivedAt: 'desc' },
            take: 200,
            select: {
                id: true,
                title: true,
                body: true,
                receivedAt: true,
                readAt: true,
                category: true,
            },
        });
        return rows.map((r) => ({
            id: r.id,
            title: r.title,
            body: r.body,
            receivedAt: r.receivedAt.toISOString(),
            read: r.readAt !== null,
            category: r.category,
        }));
    },
};
