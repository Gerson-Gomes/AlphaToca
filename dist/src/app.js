"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const cors_1 = __importDefault(require("cors"));
const errorHandler_1 = require("./middlewares/errorHandler");
const webhookRoutes_1 = __importDefault(require("./routes/webhookRoutes"));
const propertyRoutes_1 = __importDefault(require("./routes/propertyRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const visitRoutes_1 = __importDefault(require("./routes/visitRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const authController_1 = require("./controllers/authController");
const proposalRoutes_1 = __importDefault(require("./routes/proposalRoutes"));
const contractRoutes_1 = __importDefault(require("./routes/contractRoutes"));
const chatRoutes_1 = __importDefault(require("./routes/chatRoutes"));
const favoriteRoutes_1 = __importDefault(require("./routes/favoriteRoutes"));
const financeRoutes_1 = __importDefault(require("./routes/financeRoutes"));
const rentalProcessRoutes_1 = __importDefault(require("./routes/rentalProcessRoutes"));
const conversationRoutes_1 = __importDefault(require("./routes/conversationRoutes"));
const deeplinkRoutes_1 = __importDefault(require("./routes/deeplinkRoutes"));
const supportRoutes_1 = __importDefault(require("./routes/supportRoutes"));
const landlordRoutes_1 = __importDefault(require("./routes/landlordRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const authMiddleware_1 = require("./middlewares/authMiddleware");
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("./config/db"));
const logger_1 = require("./config/logger");
// Validate Auth0 configuration at startup
(0, authMiddleware_1.validateAuthConfig)();
const app = (0, express_1.default)();
// Confia no primeiro proxy da cadeia (ngrok em dev, load balancer em produção).
// Sem isso, o express-rate-limit reclama que X-Forwarded-For está presente mas
// o Express não foi instruído a confiar nele — e o IP contado vira o do proxy,
// não o do cliente real.
app.set('trust proxy', 1);
app.use((0, cors_1.default)());
app.use(express_1.default.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
// Serve static files from the 'uploads' directory.
//
// Dois mounts ANTES de `authStack` (sem checkJwt). URLs históricas em
// `PropertyImage.url` e `Contract.pdfUrl` foram gravadas como `/uploads/...`
// (ver propertyImageStorageService.savePropertyImages,
// contractDocumentStorageService.saveContractDocument). O cliente Flutter
// concatena baseUrl + image.url, então o mount em `/uploads` resolve isso
// sem migration de dados; `/api/uploads` é mantido por retrocompatibilidade
// com qualquer cliente legado/admin que tenha gravado o prefixo completo.
// Ver tasks/prd-fix-image-serving-mismatch.md.
const uploadsRoot = path_1.default.join(__dirname, '../uploads');
const setUploadsHeaders = (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
};
app.use('/uploads', express_1.default.static(uploadsRoot, { setHeaders: setUploadsHeaders }));
app.use('/api/uploads', express_1.default.static(uploadsRoot, { setHeaders: setUploadsHeaders }));
// Liveness probe — processo está respondendo.
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Readiness probe — dependências críticas estão saudáveis.
app.get('/health/ready', async (_req, res) => {
    const checks = {
        db: 'fail',
        redis: 'fail',
        gemini: 'fail',
    };
    try {
        await db_1.default.$queryRaw `SELECT 1`;
        checks.db = 'ok';
    }
    catch (err) {
        logger_1.logger.error({ err }, '[health] db check failed');
    }
    // Redis check removido — BullMQ foi substituído por Kafka.
    // Redis ainda é usado pelo Socket.IO, mas o health check do
    // Kafka Consumer já valida a conectividade indiretamente.
    // Gemini: só confirma presença da chave — não consome cota fazendo call real.
    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim() !== '') {
        checks.gemini = 'ok';
    }
    const allOk = Object.values(checks).every((v) => v === 'ok');
    res.status(allOk ? 200 : 503).json({
        status: allOk ? 'ready' : 'degraded',
        checks,
        timestamp: new Date().toISOString(),
    });
});
// Ponte de redirecionamento p/ app (pública — browser não tem JWT)
app.use('/api', deeplinkRoutes_1.default);
// Protected routes middleware chain
const authStack = [authMiddleware_1.checkJwt, authMiddleware_1.authSyncMiddleware];
// Routes
app.use('/api', webhookRoutes_1.default);
app.use('/api', propertyRoutes_1.default);
// Auth Routes (public — register and login)
app.use('/api', authRoutes_1.default);
// Auth Me (protected — requires valid token)
app.get('/api/auth/me', authStack, authController_1.authController.me);
// User Routes
app.use('/api', authStack, userRoutes_1.default);
// Visit (booking) Routes
app.use('/api', authStack, visitRoutes_1.default);
// Admin Routes (metrics, moderation queue, broadcast)
app.use('/api', authStack, adminRoutes_1.default);
// Notification Routes (histórico + leitura)
app.use('/api', authStack, notificationRoutes_1.default);
// Proposal Routes
app.use('/api', authStack, proposalRoutes_1.default);
// Contract & Tenant Routes
app.use('/api', authStack, contractRoutes_1.default);
// Chat Routes
app.use('/api', authStack, chatRoutes_1.default);
// Favorite Routes
app.use('/api', authStack, favoriteRoutes_1.default);
// Finance & Dossier Routes
app.use('/api', authStack, financeRoutes_1.default);
// Rental Process Routes
app.use('/api', authStack, rentalProcessRoutes_1.default);
// Conversation Routes (canonical chat thread resolve endpoint — US-012)
app.use('/api', authStack, conversationRoutes_1.default);
// Support Routes (ticket open — US-018)
app.use('/api', authStack, supportRoutes_1.default);
// Report Routes (user reports + admin report queue)
app.use('/api', authStack, reportRoutes_1.default);
// Landlord Dashboard Routes (metrics — LL-002)
app.use('/api', authStack, (0, authMiddleware_1.requireRole)(client_1.Role.LANDLORD), landlordRoutes_1.default);
// Apply Global Error Handler
app.use(errorHandler_1.errorHandler);
exports.default = app;
