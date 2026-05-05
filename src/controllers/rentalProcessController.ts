import { Request, Response, NextFunction } from 'express';
import { rentalProcessService } from '../services/rentalProcessService';
import { ProcessStatus } from '@prisma/client';
import { logger } from '../config/logger';

export const rentalProcessController = {
  /**
   * Lista todos os processos de locação do inquilino autenticado.
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.localUser?.id;
      if (!tenantId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const processes = await rentalProcessService.listByTenant(tenantId);
      res.json(processes);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Obtém detalhes de um processo de locação específico.
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const process = await rentalProcessService.getById(id);

      if (!process) {
        return res.status(404).json({ error: 'Processo de locação não encontrado' });
      }

      // Verifica se o usuário tem permissão (apenas o inquilino ou admin)
      if (req.localUser?.role !== 'ADMIN' && process.tenantId !== req.localUser?.id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      res.json(process);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Atualiza o status do processo de locação.
   * Aciona gatilhos de notificação no service.
   */
  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!Object.values(ProcessStatus).includes(status)) {
        return res.status(400).json({ error: 'Status inválido' });
      }

      const updated = await rentalProcessService.updateStatus(id, status as ProcessStatus);

      if (!updated) {
        return res.status(404).json({ error: 'Processo de locação não encontrado' });
      }

      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
};
