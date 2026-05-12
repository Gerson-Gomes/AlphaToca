import { Router } from 'express';
import { reportController } from '../controllers/reportController';
import { requireRole } from '../middlewares/authMiddleware';

const router = Router();

const adminOnly = requireRole('ADMIN');

router.post('/reports', reportController.create);

router.get('/admin/reports', adminOnly, reportController.listForAdmin);

router.patch('/admin/reports/:id', adminOnly, reportController.updateForAdmin);

export default router;
