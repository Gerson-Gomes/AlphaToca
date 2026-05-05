import 'dotenv/config';

import app from './app';
import './workers/whatsappWorker';
import './workers/visitReminderWorker';
import { setupSwagger } from './config/swagger';
import { bootstrapLangSmith } from './config/langsmith';
import { assertRagSecrets } from './config/rag';
import { validateWebhookConfig } from './controllers/webhookController';
import { logger } from './config/logger';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Fail-fast: valida configuração crítica antes de aceitar requisições.
assertRagSecrets();
validateWebhookConfig();

// Inicializa integrações
bootstrapLangSmith();
setupSwagger(app); // Habilita a documentação visual do Swagger

app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, '[server] server is running on 0.0.0.0');
});
