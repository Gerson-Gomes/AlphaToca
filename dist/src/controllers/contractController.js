"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractController = void 0;
const path_1 = __importDefault(require("path"));
const contractService_1 = require("../services/contractService");
const contractValidation_1 = require("../utils/contractValidation");
const contractDocumentStorageService_1 = require("../services/contractDocumentStorageService");
const propertyService_1 = require("../services/propertyService");
const logger_1 = require("../config/logger");
const UPLOADS_ROOT = path_1.default.resolve(__dirname, '../../uploads');
function handleContractError(err, res, next) {
    if (err instanceof contractService_1.ContractError) {
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
exports.contractController = {
    async create(req, res, next) {
        try {
            const input = contractValidation_1.createContractSchema.parse(req.body);
            const contract = await (0, contractService_1.createContract)(input);
            return res.status(201).json(contract);
        }
        catch (err) {
            if (err instanceof contractService_1.ContractError) {
                return handleContractError(err, res, next);
            }
            next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const contract = await (0, contractService_1.getContractById)(req.params.id);
            if (!contract) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Contract not found' }],
                });
            }
            return res.status(200).json(contract);
        }
        catch (err) {
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
    async getByPropertyAndTenant(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Authentication required.' }],
                });
            }
            const { propertyId, tenantId } = contractValidation_1.getContractQuerySchema.parse(req.query);
            const property = await propertyService_1.propertyService.getPropertyById(propertyId);
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
            const contract = await (0, contractService_1.getActiveContractByPropertyAndTenant)(propertyId, tenantId);
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
        }
        catch (err) {
            next(err);
        }
    },
    async listTenants(req, res, next) {
        try {
            const landlordId = req.query.landlordId;
            if (!landlordId) {
                return res.status(400).json({ status: 400, code: 'MISSING_PARAM', messages: [{ message: 'landlordId is required' }] });
            }
            const tenants = await (0, contractService_1.listLandlordTenants)(landlordId);
            return res.status(200).json(tenants);
        }
        catch (err) {
            next(err);
        }
    },
    async listByTenant(req, res, next) {
        try {
            const tenantId = req.params.tenantId;
            const contracts = await (0, contractService_1.listTenantContracts)(tenantId);
            return res.status(200).json(contracts);
        }
        catch (err) {
            next(err);
        }
    },
    async updatePayment(req, res, next) {
        try {
            const input = contractValidation_1.updatePaymentStatusSchema.parse(req.body);
            const payment = await (0, contractService_1.updatePaymentStatus)(req.params.paymentId, input.status, input.paidDate);
            return res.status(200).json(payment);
        }
        catch (err) {
            next(err);
        }
    },
    async updateStatus(req, res, next) {
        try {
            const input = contractValidation_1.updateContractStatusSchema.parse(req.body);
            const contract = await (0, contractService_1.updateContractStatus)(req.params.id, input.status);
            return res.status(200).json(contract);
        }
        catch (err) {
            if (err instanceof contractService_1.ContractError) {
                return handleContractError(err, res, next);
            }
            next(err);
        }
    },
    /**
     * PATCH /api/contracts/:id/document-status (LL-016)
     *
     * Guard order: 401 (no localUser) → 400 (Zod body) → 404 (missing
     * contract) → 403 (caller !== landlord of the contract). 200 body is
     * { id, documentStatus } — the minimum the UI needs to refresh its chip
     * without a round-trip back to GET /api/contracts/:id.
     */
    async updateDocumentStatus(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Authentication required.' }],
                });
            }
            const input = contractValidation_1.updateContractDocumentStatusSchema.parse(req.body);
            const updated = await (0, contractService_1.updateContractDocumentStatus)(req.params.id, localUser.id, input.documentStatus);
            return res.status(200).json(updated);
        }
        catch (err) {
            if (err instanceof contractService_1.ContractError) {
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
    async getPdf(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Authentication required.' }],
                });
            }
            const contract = await (0, contractService_1.getContractDownloadContext)(req.params.id);
            if (!contract) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Contract not found' }],
                });
            }
            const isParty = localUser.id === contract.landlordId || localUser.id === contract.tenantId;
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
            const absolutePath = path_1.default.resolve(__dirname, '../../', relative);
            if (absolutePath !== UPLOADS_ROOT &&
                !absolutePath.startsWith(UPLOADS_ROOT + path_1.default.sep)) {
                logger_1.logger.warn({ pdfUrl, absolutePath }, '[contract.getPdf] refusing to serve path outside uploads root');
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
            return res.sendFile(absolutePath, (err) => {
                if (!err)
                    return;
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
                logger_1.logger.error({ err, contractId: req.params.id }, '[contract.getPdf] sendFile failed mid-stream');
            });
        }
        catch (err) {
            next(err);
        }
    },
    /**
     * PUT /api/contracts/:id/signed-document (US-016)
     *
     * Landlord envia o PDF assinado; o backend persiste `pdfUrl` e
     * `signedAt` e devolve ambos. Ordem dos guards (espelha US-015):
     *   1. 401 UNAUTHORIZED — antes de qualquer I/O.
     *   2. 400 INVALID_FILE_TYPE — multer fileFilter rejeita mime != pdf
     *      ANTES de chegar aqui; quando o buffer chega mas os magic bytes
     *      não são `%PDF`, o controller rejeita com o mesmo code.
     *   3. 404 NOT_FOUND — contrato não existe.
     *   4. 403 FORBIDDEN — caller não é o landlord do contrato (somente o
     *      landlord pode subir, NÃO o tenant — PRD).
     *   5. 200 — { signedAt, pdfUrl }.
     *
     * Compensação em caso de falha no DB write: o arquivo já gravado em
     * disco é removido via `removeContractDocumentAbsolute` (outer
     * try/catch pattern, mesma convenção do savePropertyImages).
     */
    async uploadSignedDocument(req, res, next) {
        try {
            const localUser = req.localUser;
            if (!localUser) {
                return res.status(401).json({
                    status: 401,
                    code: 'UNAUTHORIZED',
                    messages: [{ message: 'Authentication required.' }],
                });
            }
            const file = req.file;
            if (!file) {
                return res.status(400).json({
                    status: 400,
                    code: 'VALIDATION_ERROR',
                    messages: [{ message: 'signedPdf field is required.' }],
                });
            }
            // Magic-bytes verification: every valid PDF starts with `%PDF-`.
            // Multer's fileFilter already rejects non-application/pdf Mime
            // types before we reach here, but a malicious client can lie about
            // the Content-Type of a .pdf-named text file. Re-check the bytes.
            const header = file.buffer.slice(0, 4).toString('latin1');
            if (header !== '%PDF') {
                return res.status(400).json({
                    status: 400,
                    code: 'INVALID_FILE_TYPE',
                    messages: [{ message: 'Arquivo não é um PDF válido.' }],
                });
            }
            const contractId = req.params.id;
            const contract = await (0, contractService_1.getContractDownloadContext)(contractId);
            if (!contract) {
                return res.status(404).json({
                    status: 404,
                    code: 'NOT_FOUND',
                    messages: [{ message: 'Contract not found' }],
                });
            }
            if (localUser.id !== contract.landlordId) {
                return res.status(403).json({
                    status: 403,
                    code: 'FORBIDDEN',
                    messages: [
                        { message: 'Only the contract landlord can upload the signed PDF.' },
                    ],
                });
            }
            // Storage write FIRST (produces URL), then DB write. On DB failure
            // we compensate by deleting the disk file. Opposite order (DB
            // first, storage after) would leave the DB pointing at a missing
            // file if the storage write fails.
            const saved = await (0, contractDocumentStorageService_1.saveSignedContractPdf)(contractId, file.buffer);
            try {
                const view = await (0, contractService_1.attachSignedPdfToContract)(contractId, saved.url);
                return res.status(200).json(view);
            }
            catch (dbErr) {
                // Compensate: remove the just-written file so disk and DB stay
                // in sync. Cleanup failures are logged but don't hide the
                // original DB error from the caller.
                await (0, contractDocumentStorageService_1.removeContractDocumentAbsolute)(saved.absolutePath).catch((cleanupErr) => {
                    logger_1.logger.warn({ cleanupErr, contractId, absolutePath: saved.absolutePath }, '[contract.uploadSignedDocument] failed to clean up orphan PDF after DB rollback');
                });
                throw dbErr;
            }
        }
        catch (err) {
            next(err);
        }
    }
};
