import { kafka } from '../config/kafka';
import { handleWhatsappMessage } from './whatsappWorker';
import prisma from '../config/db';
import { sendMessage as defaultSendMessage } from '../services/whatsappService';
import { generateAnswer as defaultGenerateAnswer } from '../services/ragChainService';
import { extractInsights as defaultExtractInsights } from '../services/leadExtractionService';
import { extractSearchFilters as defaultExtractSearchFilters } from '../services/searchExtractionService';
import { propertyService } from '../services/propertyService';
import { logger } from '../config/logger';
import { WhatsAppWebhookPayload } from '../types/whatsapp';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { databaseRepository } from '../services/databaseRepository';
import { runAgentOrchestration } from '../services/agentOrchestratorService';

const TOPIC = 'chat-events';
const GROUP_ID = 'chat-ai-group';

const consumer = kafka.consumer({ groupId: GROUP_ID });

export const startChatWorker = async () => {
  try {
    await consumer.connect();
    logger.info(`[ChatWorker] Consumidor conectado ao grupo ${GROUP_ID}`);

    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
    logger.info(`[ChatWorker] Inscrito no tópico: ${TOPIC}`);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const startedAt = Date.now();
        const rawValue = message.value?.toString();
        
        if (!rawValue) return;

        try {
          const payload: WhatsAppWebhookPayload = JSON.parse(rawValue);
          
          // Extraímos o wamid para log
          const wamid = (payload as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
          const chatLog = logger.child({ topic, partition, offset: message.offset, wamid });

          chatLog.info('[ChatWorker] Processando mensagem do Kafka');

          const changeValue = payload.entry?.[0]?.changes?.[0]?.value;
          const whatsappMessage = changeValue?.messages?.[0];
          const contact = changeValue?.contacts?.[0];

          if (!whatsappMessage || !contact || !whatsappMessage.text) {
            chatLog.info('[ChatWorker] Mensagem ignorada (não é texto ou payload incompleto)');
            return;
          }

          const phoneNumber = contact.wa_id;
          const userMessageText = whatsappMessage.text.body;

          // 1. Recuperar ou criar o usuário e a sessão (Lógica similar ao whatsappWorker)
          const user = await prisma.user.upsert({
            where: { phoneNumber },
            update: { name: contact.profile?.name || 'Lead' },
            create: {
              phoneNumber,
              name: contact.profile?.name || 'Lead',
              role: 'TENANT',
            },
          });

          let chatSession = await prisma.chatSession.findFirst({
            where: { tenantId: user.id },
            orderBy: { startedAt: 'desc' },
          });

          if (!chatSession || chatSession.status === 'RESOLVED') {
            chatSession = await prisma.chatSession.create({
              data: {
                tenantId: user.id,
                status: 'ACTIVE_BOT',
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
              },
            });
          }

          const sessionId = chatSession.id;

          // 2. Salvar mensagem do usuário no banco
          await databaseRepository.saveMessage({
            sessionId,
            senderType: 'TENANT',
            content: userMessageText,
          });

          // 3. Recuperar Histórico via Repositório (Injeção de dependência)
          const historyRaw = await databaseRepository.getHistory(sessionId, 10);
          const history = historyRaw.map(m => m.senderType === 'BOT' ? new AIMessage(m.content) : new HumanMessage(m.content)).reverse();

          // 4. Executar Orquestração de IA (LangGraph / ReAct)
          const { answer } = await runAgentOrchestration(sessionId, userMessageText, history);

          // 5. Salvar Resposta no Banco
          await databaseRepository.saveMessage({
            sessionId,
            senderType: 'BOT',
            content: answer,
          });

          // 6. Enviar via WhatsApp
          await defaultSendMessage(phoneNumber, answer);

          const elapsed = Date.now() - startedAt;
          chatLog.info({ elapsedMs: elapsed, success: true }, '[ChatWorker] Resposta enviada com sucesso via LangGraph');

        } catch (error) {
          logger.error({ error, rawValue }, '[ChatWorker] Erro ao processar mensagem do Kafka');
          // No Kafka, se não dermos erro aqui, ele faz o commit do offset.
          // Em caso de erro crítico de infra, poderíamos lançar o erro para o Kafka tentar novamente (retry).
        }
      },
    });
  } catch (error) {
    logger.error({ error }, '[ChatWorker] Falha crítica ao iniciar o worker');
    process.exit(1);
  }
};

// Se este arquivo for executado diretamente
if (require.main === module) {
  startChatWorker();
}
