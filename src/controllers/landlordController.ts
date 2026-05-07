import { Request, Response, NextFunction } from 'express';
import { Prisma, ProposalStatus } from '@prisma/client';
import prisma from '../config/db';
import { logger } from '../config/logger';

const PROFILE_VIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function countUnreadMessages(landlordId: string): Promise<number> {
  // LL-010 will add the ConversationMessage model. Until that migration lands
  // the table does not exist in Supabase, so the COUNT below would throw a
  // P2021 "table does not exist" error. Swallow exactly that case and return
  // 0 so the dashboard top-card renders without falling back to mocks.
  try {
    return await (prisma as any).conversationMessage.count({
      where: {
        readAt: null,
        conversation: { landlordId },
        authorId: { not: landlordId },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
      return 0;
    }
    // Model not present in generated client yet (pre-LL-010 generate).
    const message = err instanceof Error ? err.message : String(err);
    if (/conversationMessage/i.test(message) && /undefined|not a function/i.test(message)) {
      return 0;
    }
    logger.error({ err, landlordId }, '[landlordController] unreadMessages count failed');
    return 0;
  }
}

export const landlordController = {
  /**
   * GET /api/landlord/metrics
   *
   * Returns the three top-card dashboard metrics in a single round trip so the
   * Flutter landlord home stops making parallel calls and stops falling back
   * to mocked counts:
   *   - profileViews:     ProfileView rows for this landlord in the last 30d.
   *   - proposalsPending: open PENDING proposals across the landlord's listings.
   *   - unreadMessages:   tenant-authored ConversationMessage rows with readAt
   *                       still null. Returns 0 gracefully until LL-010 lands
   *                       the ConversationMessage table.
   *
   * Auth stack is applied at the app.ts mount (authStack + requireRole(LANDLORD)).
   */
  async getMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const landlordId = localUser.id;
      const since = new Date(Date.now() - PROFILE_VIEW_WINDOW_MS);

      const [profileViews, proposalsPending, unreadMessages] = await Promise.all([
        prisma.profileView.count({
          where: { landlordId, viewedAt: { gte: since } },
        }),
        prisma.proposal.count({
          where: {
            status: ProposalStatus.PENDING,
            property: { landlordId },
          },
        }),
        countUnreadMessages(landlordId),
      ]);

      return res.status(200).json({ profileViews, proposalsPending, unreadMessages });
    } catch (error) {
      next(error);
    }
  },
};
