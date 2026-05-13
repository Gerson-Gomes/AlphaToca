"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rentalProcessController = void 0;
const rentalProcessService_1 = require("../services/rentalProcessService");
const client_1 = require("@prisma/client");
exports.rentalProcessController = {
    /**
     * Lista todos os processos de locação do inquilino autenticado.
     */
    async list(req, res, next) {
        try {
            const tenantId = req.localUser?.id;
            if (!tenantId) {
                return res.status(401).json({ error: 'Usuário não autenticado' });
            }
            const processes = await rentalProcessService_1.rentalProcessService.listByTenant(tenantId);
            res.json(processes);
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Obtém detalhes de um processo de locação específico.
     */
    async getById(req, res, next) {
        try {
            const { id } = req.params;
            const process = await rentalProcessService_1.rentalProcessService.getById(id);
            if (!process) {
                return res.status(404).json({ error: 'Processo de locação não encontrado' });
            }
            // Verifica se o usuário tem permissão (apenas o inquilino ou admin)
            if (req.localUser?.role !== 'ADMIN' && process.tenantId !== req.localUser?.id) {
                return res.status(403).json({ error: 'Acesso negado' });
            }
            res.json(process);
        }
        catch (error) {
            next(error);
        }
    },
    /**
     * Atualiza o status do processo de locação.
     * Aciona gatilhos de notificação no service.
     */
    async updateStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { status } = req.body;
            if (!Object.values(client_1.ProcessStatus).includes(status)) {
                return res.status(400).json({ error: 'Status inválido' });
            }
            const updated = await rentalProcessService_1.rentalProcessService.updateStatus(id, status);
            if (!updated) {
                return res.status(404).json({ error: 'Processo de locação não encontrado' });
            }
            res.json(updated);
        }
        catch (error) {
            next(error);
        }
    },
};
