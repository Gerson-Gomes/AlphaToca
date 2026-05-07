import { Request, Response, NextFunction } from 'express';
import path from 'path';
import {
  createContract,
  getContractById,
  getActiveContractByPropertyAndTenant,
  getContractDownloadContext,
  listLandlordTenants,
  listTenantContracts,
  updateContractStatus,
  updatePaymentStatus,
  ContractError
} from '../services/contractService';
import {
  createContractSchema,
  getContractQuerySchema,
  updateContractStatusSchema,
  updatePaymentStatusSchema
} from '../utils/contractValidation';
import { propertyService } from '../services/propertyService';
import { logger } from '../config/logger';

const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');

function handleContractError(err: unknown, res: Response, next: NextFunction): boolean {
  if (err instanceof ContractError) {
    res.status(err.httpStatus).json({
      status: err.httpStatus,
      code: err.code,
      messages: [{ message: err.message }],
    });
    return true;
  }
  next(err);
  return false;
}

export const contractController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createContractSchema.parse(req.body);
      const contract = await createContract(input);
      return res.status(201).json(contract);
    } catch (err) {
      if (err instanceof ContractError) {
        return handleContractError(err, res, next);
      }
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const contract = await getContractById(req.params.id);
      if (!contract) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Contract not found' }],
        });
      }
      return res.status(200).json(contract);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/contracts?propertyId=<uuid>&tenantId=<uuid> (US-014)
   *
   * Retorna o contrato ACTIVE entre um imóvel e um tenant. Autorização:
   * caller precisa ser o landlord dono do imóvel OU o próprio tenant
   * indicado. Ordem dos guards (espelha US-012):
   *   1. 401 UNAUTHORIZED — antes de qualquer I/O.
   *   2. 400 VALIDATION_ERROR — Zod valida UUIDs sem tocar no banco.
   *   3. 404 NOT_FOUND — imóvel não existe; retornado ANTES da checagem
   *      de auth para manter paridade com o pattern estabelecido em
   *      US-012 (property primeiro, auth depois).
   *   4. 403 FORBIDDEN — caller não é landlord nem o tenant da query.
   *   5. 404 CONTRACT_NOT_FOUND — nenhum contrato ACTIVE para o par.
   *   6. 200 — view projetada (omite landlordId/dueDay/status/createdAt/
   *      updatedAt por contrato PRD). `pdfUrl`/`signedAt` = null quando
   *      ainda não houve upload.
   */
  async getByPropertyAndTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const { propertyId, tenantId } = getContractQuerySchema.parse(req.query);

      const property = await propertyService.getPropertyById(propertyId);
      if (!property) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Property not found' }],
        });
      }

      const isLandlord = localUser.id === property.landlordId;
      const isTenant = localUser.id === tenantId;
      if (!isLandlord && !isTenant) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [
            { message: 'Only the property owner or the specified tenant can read this contract.' },
          ],
        });
      }

      const contract = await getActiveContractByPropertyAndTenant(propertyId, tenantId);
      if (!contract) {
        return res.status(404).json({
          status: 404,
          code: 'CONTRACT_NOT_FOUND',
          messages: [{ message: 'No active contract between the property and the tenant.' }],
        });
      }

      // landlordId é usado só para autorização downstream; o contrato PRD
      // US-014 projeta apenas {id, propertyId, tenantId, startDate, endDate,
      // monthlyRent, pdfUrl, signedAt}.
      const { landlordId: _landlordId, ...view } = contract;
      return res.status(200).json(view);
    } catch (err) {
      next(err);
    }
  },

  async listTenants(req: Request, res: Response, next: NextFunction) {
    try {
      const landlordId = req.query.landlordId as string;
      if (!landlordId) {
        return res.status(400).json({ status: 400, code: 'MISSING_PARAM', messages: [{ message: 'landlordId is required' }] });
      }
      const tenants = await listLandlordTenants(landlordId);
      return res.status(200).json(tenants);
    } catch (err) {
      next(err);
    }
  },

  async listByTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.params.tenantId;
      const contracts = await listTenantContracts(tenantId);
      return res.status(200).json(contracts);
    } catch (err) {
      next(err);
    }
  },

  async updatePayment(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updatePaymentStatusSchema.parse(req.body);
      const payment = await updatePaymentStatus(req.params.paymentId, input.status, input.paidDate);
      return res.status(200).json(payment);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateContractStatusSchema.parse(req.body);
      const contract = await updateContractStatus(req.params.id, input.status);
      return res.status(200).json(contract);
    } catch (err) {
      if (err instanceof ContractError) {
        return handleContractError(err, res, next);
      }
      next(err);
    }
  },

  /**
   * GET /api/contracts/:id/pdf (US-015)
   *
   * Download do PDF do contrato. Autorização: o caller precisa ser o
   * landlord OU o tenant do contrato (qualquer outro usuário autenticado
   * recebe 403).
   *
   * Storage strategy (documentado em progress.txt — US-015):
   * o backend atual serve arquivos locais em `uploads/` via express.static
   * e não tem signed-URL support. Então:
   *   - `pdfUrl` relativo (ex.: `/uploads/contracts/<id>.pdf`) → o endpoint
   *     faz stream do arquivo com Content-Type: application/pdf.
   *   - `pdfUrl` absoluto (http:// ou https://) → 302 redirect pro Location,
   *     deixando o storage backend externo servir os bytes. Esse branch é
   *     forward-compatible com uma futura migração pra S3/Firebase com
   *     signed URLs — não precisa mexer no controller.
   *
   * Guard order:
   *   1. 401 UNAUTHORIZED
   *   2. 404 NOT_FOUND quando o contrato não existe
   *   3. 403 FORBIDDEN quando o caller não é landlord nem tenant
   *   4. 404 CONTRACT_PDF_NOT_AVAILABLE quando `pdfUrl` é null OU o arquivo
   *      sumiu do disco (ENOENT). Uma única code unifica "nunca existiu" e
   *      "deletado pós-gravação" pra simplificar o frontend.
   */
  async getPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const localUser = req.localUser;
      if (!localUser) {
        return res.status(401).json({
          status: 401,
          code: 'UNAUTHORIZED',
          messages: [{ message: 'Authentication required.' }],
        });
      }

      const contract = await getContractDownloadContext(req.params.id);
      if (!contract) {
        return res.status(404).json({
          status: 404,
          code: 'NOT_FOUND',
          messages: [{ message: 'Contract not found' }],
        });
      }

      const isParty =
        localUser.id === contract.landlordId || localUser.id === contract.tenantId;
      if (!isParty) {
        return res.status(403).json({
          status: 403,
          code: 'FORBIDDEN',
          messages: [
            { message: 'Only the contract landlord or tenant can download the PDF.' },
          ],
        });
      }

      const { pdfUrl } = contract;
      if (!pdfUrl) {
        return res.status(404).json({
          status: 404,
          code: 'CONTRACT_PDF_NOT_AVAILABLE',
          messages: [{ message: 'No PDF document is attached to this contract.' }],
        });
      }

      // Signed-URL / external storage path — let the backend serve bytes.
      if (/^https?:\/\//i.test(pdfUrl)) {
        res.setHeader('Cache-Control', 'private, no-store');
        return res.redirect(302, pdfUrl);
      }

      // Local filesystem path (`/uploads/<...>/<file>.pdf`). Strip the
      // leading slash so path.resolve treats it as relative to the repo
      // root — otherwise path.resolve would honor the absolute leading `/`
      // and escape the repo. Defense-in-depth: reject anything that, after
      // normalization, lands outside UPLOADS_ROOT (blocks `..` traversal).
      const relative = pdfUrl.replace(/^\/+/, '');
      const absolutePath = path.resolve(__dirname, '../../', relative);
      if (
        absolutePath !== UPLOADS_ROOT &&
        !absolutePath.startsWith(UPLOADS_ROOT + path.sep)
      ) {
        logger.warn(
          { pdfUrl, absolutePath },
          '[contract.getPdf] refusing to serve path outside uploads root',
        );
        return res.status(404).json({
          status: 404,
          code: 'CONTRACT_PDF_NOT_AVAILABLE',
          messages: [{ message: 'Contract PDF file is missing from storage.' }],
        });
      }

      // Let sendFile derive Content-Type from the `.pdf` extension via its
      // internal mime lookup (resolves to `application/pdf`). Setting it
      // explicitly BEFORE sendFile would win against res.json() on the
      // ENOENT error branch — res.json only sets Content-Type when the
      // response has none yet — and the error envelope would end up
      // served as application/pdf (binary) to the client.
      res.setHeader('Cache-Control', 'private, no-store');
      return res.sendFile(absolutePath, (err?: NodeJS.ErrnoException) => {
        if (!err) return;
        // sendFile stats the file first, so ENOENT fires BEFORE any bytes
        // have been written — we can still respond with a clean 404 JSON.
        if (err.code === 'ENOENT') {
          if (!res.headersSent) {
            return res.status(404).json({
              status: 404,
              code: 'CONTRACT_PDF_NOT_AVAILABLE',
              messages: [{ message: 'Contract PDF file is missing from storage.' }],
            });
          }
          return;
        }
        if (!res.headersSent) {
          return next(err);
        }
        logger.error(
          { err, contractId: req.params.id },
          '[contract.getPdf] sendFile failed mid-stream',
        );
      });
    } catch (err) {
      next(err);
    }
  }
};
