"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.financeController = void 0;
const propertyFinanceService_1 = require("../services/propertyFinanceService");
const zod_1 = require("zod");
const expenseSchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid(),
    type: zod_1.z.string(),
    amount: zod_1.z.number().positive(),
    dueDate: zod_1.z.string(), // ISO string or simple date
    year: zod_1.z.number().int(),
    month: zod_1.z.number().int().min(1).max(12),
    isPaid: zod_1.z.boolean().optional(),
});
const maintenanceSchema = zod_1.z.object({
    propertyId: zod_1.z.string().uuid(),
    title: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    cost: zod_1.z.number().positive().optional(),
    date: zod_1.z.string(),
    status: zod_1.z.string().optional(),
});
exports.financeController = {
    async addExpense(req, res, next) {
        try {
            const data = expenseSchema.parse(req.body);
            const expense = await (0, propertyFinanceService_1.addExpense)(data);
            return res.status(201).json(expense);
        }
        catch (err) {
            next(err);
        }
    },
    async addMaintenance(req, res, next) {
        try {
            const data = maintenanceSchema.parse(req.body);
            const maintenance = await (0, propertyFinanceService_1.addMaintenance)(data);
            return res.status(201).json(maintenance);
        }
        catch (err) {
            next(err);
        }
    },
    async getDossier(req, res, next) {
        try {
            const dossier = await (0, propertyFinanceService_1.getPropertyDossier)(req.params.propertyId);
            if (!dossier) {
                return res.status(404).json({ status: 404, code: 'NOT_FOUND', messages: [{ message: 'Property not found' }] });
            }
            return res.status(200).json(dossier);
        }
        catch (err) {
            next(err);
        }
    },
    async getAnalytics(req, res, next) {
        try {
            const landlordId = req.query.landlordId;
            if (!landlordId) {
                return res.status(400).json({ status: 400, code: 'MISSING_PARAM', messages: [{ message: 'landlordId is required' }] });
            }
            const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
            const summary = await (0, propertyFinanceService_1.getLandlordFinancialSummary)(landlordId, year);
            return res.status(200).json(summary);
        }
        catch (err) {
            next(err);
        }
    }
};
