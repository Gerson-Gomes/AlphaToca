"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contractController_1 = require("../controllers/contractController");
const contractDocumentUploadMiddleware_1 = require("../middlewares/contractDocumentUploadMiddleware");
const router = (0, express_1.Router)();
/**
 * @swagger
 * /contracts:
 *   post:
 *     summary: Cria um novo contrato de aluguel
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, tenantId, landlordId, startDate, endDate, monthlyRent, dueDay]
 *             properties:
 *               propertyId: { type: 'string', format: 'uuid' }
 *               tenantId: { type: 'string', format: 'uuid' }
 *               landlordId: { type: 'string', format: 'uuid' }
 *               startDate: { type: 'string', format: 'date-time' }
 *               endDate: { type: 'string', format: 'date-time' }
 *               monthlyRent: { type: 'number' }
 *               dueDay: { type: 'integer', minimum: 1, maximum: 31 }
 *               pdfUrl: { type: 'string', format: 'uri' }
 *     responses:
 *       201:
 *         description: Contrato criado com sucesso
 */
router.post('/contracts', contractController_1.contractController.create);
/**
 * @swagger
 * /contracts:
 *   get:
 *     summary: Busca o contrato ACTIVE entre um imóvel e um tenant (US-014)
 *     description: |
 *       Retorna o contrato com `status=ACTIVE` que liga o `propertyId` ao
 *       `tenantId` informados. Contratos TERMINATED/COMPLETED NÃO satisfazem
 *       a busca — o endpoint é focado no ciclo ativo.
 *
 *       Autorização: o caller deve ser o landlord dono do imóvel OU o
 *       próprio tenant indicado na query. Qualquer outro usuário autenticado
 *       recebe 403.
 *
 *       Resposta projetada (subset deliberado do modelo `Contract`): omite
 *       `landlordId`, `dueDay`, `status`, `createdAt` e `updatedAt`. Os
 *       campos `pdfUrl` e `signedAt` são `null` (e não `undefined`) enquanto
 *       o landlord não fez upload do PDF assinado (PUT /api/contracts/:id/signed-document, US-016).
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: propertyId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *       - in: query
 *         name: tenantId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Contrato ACTIVE encontrado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [id, propertyId, tenantId, startDate, endDate, monthlyRent, pdfUrl, signedAt, documentStatus]
 *               properties:
 *                 id: { type: 'string', format: 'uuid' }
 *                 propertyId: { type: 'string', format: 'uuid' }
 *                 tenantId: { type: 'string', format: 'uuid' }
 *                 startDate: { type: 'string', format: 'date-time' }
 *                 endDate: { type: 'string', format: 'date-time' }
 *                 monthlyRent: { type: 'number', example: 2500.00 }
 *                 pdfUrl: { type: 'string', format: 'uri', nullable: true }
 *                 signedAt: { type: 'string', format: 'date-time', nullable: true }
 *                 documentStatus:
 *                   type: string
 *                   enum: [PENDING_DOCUMENTS, AWAITING_SIGNATURE, APPROVED]
 *       400:
 *         description: Query params inválidos (propertyId/tenantId fora do formato UUID ou ausentes).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Caller não é landlord do imóvel nem o tenant especificado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Propriedade não encontrada (`NOT_FOUND`) OU sem contrato ACTIVE para o par (`CONTRACT_NOT_FOUND`).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/contracts', contractController_1.contractController.getByPropertyAndTenant);
/**
 * @swagger
 * /contracts/{id}:
 *   get:
 *     summary: Busca detalhes de um contrato
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Detalhes do contrato
 */
router.get('/contracts/:id', contractController_1.contractController.getById);
/**
 * @swagger
 * /contracts/{id}/pdf:
 *   get:
 *     summary: Download do PDF do contrato (US-015)
 *     description: |
 *       Retorna o PDF associado ao contrato. Autorização: o caller deve ser
 *       o landlord OU o tenant do contrato — qualquer outro usuário
 *       autenticado recebe 403.
 *
 *       Estratégia de storage: quando `Contract.pdfUrl` é um path relativo
 *       (ex.: `/uploads/contracts/<id>.pdf`) o endpoint faz **stream** do
 *       arquivo com `Content-Type: application/pdf`. Quando `pdfUrl` é uma
 *       URL absoluta (http/https — cenário futuro com S3/Firebase + signed
 *       URLs), o endpoint responde **302** com o Location apontando pro
 *       backend externo. O frontend deve tratar ambos os caminhos (seguir
 *       redirect automaticamente ou consumir o stream direto).
 *
 *       Erros esperados:
 *       - `404 NOT_FOUND` — o contrato não existe.
 *       - `404 CONTRACT_PDF_NOT_AVAILABLE` — `pdfUrl` é `null` OU o arquivo
 *         sumiu do disco. O frontend pode usar o mesmo texto pros dois.
 *       - `403 FORBIDDEN` — caller não é parte do contrato.
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Bytes do PDF.
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       302:
 *         description: Signed URL de storage externo (Location header aponta pro PDF).
 *         headers:
 *           Location:
 *             description: URL assinada de curta duração do storage backend.
 *             schema: { type: 'string', format: 'uri' }
 *       401:
 *         description: Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Caller não é landlord nem tenant do contrato.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Contrato não existe (`NOT_FOUND`) OU não há PDF anexado / arquivo sumiu (`CONTRACT_PDF_NOT_AVAILABLE`).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/contracts/:id/pdf', contractController_1.contractController.getPdf);
/**
 * @swagger
 * /contracts/{id}/signed-document:
 *   put:
 *     summary: Upload do PDF assinado do contrato (US-016)
 *     description: |
 *       O landlord envia o PDF assinado (multipart/form-data, campo `signedPdf`).
 *       O backend valida:
 *       - `Content-Type` do arquivo é `application/pdf` (rejeita antes de buferizar).
 *       - Magic bytes — os 4 primeiros bytes do buffer são `%PDF` (defesa contra
 *         clientes que mentem no mime type).
 *
 *       Limite de tamanho: 15MB por padrão. Configurável via variável de ambiente
 *       `CONTRACT_PDF_MAX_BYTES` (bytes). Acima do limite retorna 400
 *       `FILE_TOO_LARGE`.
 *
 *       Autorização: somente o landlord do contrato pode subir. Tenant ou
 *       terceiros autenticados recebem 403.
 *
 *       Persiste `pdfUrl` (path relativo de storage) + `signedAt` (timestamp do
 *       servidor). Se o DB write falhar após a gravação em disco, o arquivo é
 *       removido para evitar orfãos (outer try/catch compensation).
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [signedPdf]
 *             properties:
 *               signedPdf:
 *                 type: string
 *                 format: binary
 *                 description: PDF assinado (application/pdf, max 15MB por padrão).
 *     responses:
 *       200:
 *         description: Upload bem-sucedido. Retorna o PDF atualmente vinculado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [pdfUrl, signedAt]
 *               properties:
 *                 pdfUrl:
 *                   type: string
 *                   example: '/uploads/contracts/55555555-5555-5555-5555-555555555555/abc.pdf'
 *                 signedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: |
 *           Falha de upload/validação:
 *           - `INVALID_FILE_TYPE` — mime não é `application/pdf` OU magic bytes não são `%PDF`.
 *           - `FILE_TOO_LARGE` — excede `CONTRACT_PDF_MAX_BYTES` (default 15MB).
 *           - `UNEXPECTED_FILE_FIELD` — campo do multipart diferente de `signedPdf`.
 *           - `VALIDATION_ERROR` — campo `signedPdf` ausente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Caller não é o landlord do contrato.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Contrato não encontrado (`NOT_FOUND`).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put('/contracts/:id/signed-document', contractDocumentUploadMiddleware_1.contractDocumentUploadHandler, contractController_1.contractController.uploadSignedDocument);
/**
 * @swagger
 * /contracts/{id}/status:
 *   patch:
 *     summary: Atualiza o status do contrato (ACTIVE | TERMINATED | COMPLETED)
 *     description: |
 *       Atualiza `Contract.status`. Como efeito colateral, `Property.status` é
 *       ajustado na **mesma transação** para manter a consistência lifecycle:
 *       - ACTIVE → TERMINATED/COMPLETED: `Property.status` volta para `AVAILABLE`.
 *       - qualquer terminal → ACTIVE: `Property.status` passa a `RENTED`
 *         (rejeita com 409 `RENTAL_PROCESS_ALREADY_ACTIVE` se já houver outro
 *         contrato ACTIVE para o imóvel).
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: 'string', enum: [ACTIVE, TERMINATED, COMPLETED] }
 *     responses:
 *       200:
 *         description: Contrato atualizado com sucesso
 *       404: { description: Contrato não encontrado }
 *       409: { description: Outro contrato já está ACTIVE para este imóvel }
 */
router.patch('/contracts/:id/status', contractController_1.contractController.updateStatus);
/**
 * @swagger
 * /contracts/{id}/document-status:
 *   patch:
 *     summary: Atualiza o status documental do contrato (LL-016)
 *     description: |
 *       Atualiza `Contract.documentStatus` — campo independente de
 *       `Contract.status`, usado pelo chip de status documental na tela
 *       "Meus Inquilinos" do landlord.
 *
 *       Autorização: somente o landlord do contrato pode alterar. Tenants e
 *       terceiros autenticados recebem 403 FORBIDDEN.
 *
 *       Valores válidos: `PENDING_DOCUMENTS`, `AWAITING_SIGNATURE`, `APPROVED`.
 *       Qualquer outro valor retorna 400 VALIDATION_ERROR antes de tocar no
 *       banco.
 *
 *       Resposta 200 traz o mínimo necessário para o frontend atualizar o
 *       chip sem refetch: `{ id, documentStatus }`. Para ler o contrato
 *       completo use `GET /api/contracts/:id`.
 *     tags: [Contratos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documentStatus]
 *             properties:
 *               documentStatus:
 *                 type: string
 *                 enum: [PENDING_DOCUMENTS, AWAITING_SIGNATURE, APPROVED]
 *     responses:
 *       200:
 *         description: Status documental atualizado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [id, documentStatus]
 *               properties:
 *                 id: { type: 'string', format: 'uuid' }
 *                 documentStatus:
 *                   type: string
 *                   enum: [PENDING_DOCUMENTS, AWAITING_SIGNATURE, APPROVED]
 *       400:
 *         description: "`documentStatus` ausente ou fora do enum."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token ausente ou inválido.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Caller não é o landlord do contrato.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Contrato não encontrado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/contracts/:id/document-status', contractController_1.contractController.updateDocumentStatus);
/**
 * @swagger
 * /tenants:
 *   get:
 *     summary: Lista inquilinos de um proprietário
 *     tags: [Inquilinos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: landlordId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Lista de inquilinos e seus contratos ativos
 */
router.get('/tenants', contractController_1.contractController.listTenants);
/**
 * @swagger
 * /tenants/{tenantId}/contracts:
 *   get:
 *     summary: Lista contratos de um inquilino específico
 *     tags: [Inquilinos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     responses:
 *       200:
 *         description: Lista de contratos
 */
router.get('/tenants/:tenantId/contracts', contractController_1.contractController.listByTenant);
/**
 * @swagger
 * /payments/{paymentId}:
 *   patch:
 *     summary: Atualiza o status de um pagamento de aluguel
 *     tags: [Financeiro]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: 'string', format: 'uuid' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: 'string', enum: [PENDING, PAID, OVERDUE, CANCELLED] }
 *               paidDate: { type: 'string', format: 'date-time' }
 *     responses:
 *       200:
 *         description: Pagamento atualizado
 */
router.patch('/payments/:paymentId', contractController_1.contractController.updatePayment);
exports.default = router;
