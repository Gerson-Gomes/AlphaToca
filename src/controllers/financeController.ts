import { Request, Response, NextFunction } from 'express';
import { 
  addExpense, 
  addMaintenance, 
  getPropertyDossier, 
  getLandlordFinancialSummary 
} from '../services/propertyFinanceService';
import { z } from 'zod';

const expenseSchema = z.object({
  propertyId: z.string().uuid(),
  type: z.string(),
  amount: z.number().positive(),
  dueDate: z.string(), // ISO string or simple date
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  isPaid: z.boolean().optional(),
});

const maintenanceSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string(),
  description: z.string().optional(),
  cost: z.number().positive().optional(),
  date: z.string(),
  status: z.string().optional(),
});

export const financeController = {
  async addExpense(req: Request, res: Response, next: NextFunction) {
    try {
      const data = expenseSchema.parse(req.body);
      const expense = await addExpense(data);
      return res.status(201).json(expense);
    } catch (err) {
      next(err);
    }
  },

  async addMaintenance(req: Request, res: Response, next: NextFunction) {
    try {
      const data = maintenanceSchema.parse(req.body);
      const maintenance = await addMaintenance(data);
      return res.status(201).json(maintenance);
    } catch (err) {
      next(err);
    }
  },

  async getDossier(req: Request, res: Response, next: NextFunction) {
    try {
      const dossier = await getPropertyDossier(req.params.propertyId);
      if (!dossier) {
        return res.status(404).json({ status: 404, code: 'NOT_FOUND', messages: [{ message: 'Property not found' }] });
      }
      return res.status(200).json(dossier);
    } catch (err) {
      next(err);
    }
  },

  async getAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const landlordId = req.query.landlordId as string;
      if (!landlordId) {
        return res.status(400).json({ status: 400, code: 'MISSING_PARAM', messages: [{ message: 'landlordId is required' }] });
      }
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const summary = await getLandlordFinancialSummary(landlordId, year);
      return res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  }
};
