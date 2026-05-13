"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addExpense = addExpense;
exports.addMaintenance = addMaintenance;
exports.getPropertyDossier = getPropertyDossier;
exports.getLandlordFinancialSummary = getLandlordFinancialSummary;
const db_1 = __importDefault(require("../config/db"));
const client_1 = require("@prisma/client");
async function addExpense(data) {
    return db_1.default.propertyExpense.create({
        data: {
            ...data,
            dueDate: new Date(data.dueDate),
            amount: new client_1.Prisma.Decimal(data.amount),
        }
    });
}
async function addMaintenance(data) {
    return db_1.default.maintenanceLog.create({
        data: {
            ...data,
            date: new Date(data.date),
            cost: data.cost ? new client_1.Prisma.Decimal(data.cost) : null,
        }
    });
}
async function getPropertyDossier(propertyId) {
    const property = await db_1.default.property.findUnique({
        where: { id: propertyId },
        include: {
            expenses: { orderBy: { dueDate: 'desc' }, take: 20 },
            maintenanceLogs: { orderBy: { date: 'desc' }, take: 20 },
            contracts: {
                where: { status: 'ACTIVE' },
                include: { tenant: { select: { id: true, name: true } } }
            }
        }
    });
    return property;
}
async function getLandlordFinancialSummary(landlordId, year) {
    // 1. Busca todos os imóveis do proprietário
    const properties = await db_1.default.property.findMany({
        where: { landlordId },
        include: {
            contracts: {
                where: {
                    status: 'ACTIVE',
                    startDate: { lte: new Date(`${year}-12-31`) },
                    OR: [
                        { endDate: { gte: new Date(`${year}-01-01`) } },
                        { endDate: { equals: undefined } } // Se não tiver fim, assume ativo
                    ]
                }
            },
            expenses: { where: { year } },
        }
    });
    // 2. Inicializa dados mensais
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        revenue: 0,
        expenses: 0,
        net: 0
    }));
    properties.forEach(p => {
        // Soma receita (simplificada para o demo/MVP)
        p.contracts.forEach(c => {
            const startMonth = c.startDate.getFullYear() === year ? c.startDate.getMonth() : 0;
            const endMonth = (c.endDate && c.endDate.getFullYear() === year) ? c.endDate.getMonth() : 11;
            for (let m = startMonth; m <= endMonth; m++) {
                monthlyData[m].revenue += Number(c.monthlyRent);
            }
        });
        // Soma despesas registradas no banco
        p.expenses.forEach(e => {
            if (e.month >= 1 && e.month <= 12) {
                monthlyData[e.month - 1].expenses += Number(e.amount);
            }
        });
    });
    monthlyData.forEach(d => {
        d.net = d.revenue - d.expenses;
    });
    return monthlyData;
}
