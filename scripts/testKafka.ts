import { kafka } from '../src/config/kafka';

const producer = kafka.producer();

async function test() {
  console.log('--- Iniciando Teste do Kafka ---');
  
  try {
    await producer.connect();
    console.log('✅ Produtor de teste conectado!');

    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WHATSAPP_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '123456', phone_number_id: '123456' },
            contacts: [{ profile: { name: 'Teste Kafka' }, wa_id: '5511999999999' }],
            messages: [{
              from: '5511999999999',
              id: 'wamid.test_' + Date.now(),
              timestamp: Math.floor(Date.now() / 1000).toString(),
              text: { body: 'Olá! Como funciona o processo de aluguel de vocês?' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    console.log('📤 Enviando mensagem para o tópico "chat-events"...');
    
    await producer.send({
      topic: 'chat-events',
      messages: [{ value: JSON.stringify(payload) }],
    });

    console.log('🚀 Mensagem enviada com sucesso!');
    console.log('Verifique os logs do seu servidor (npm run dev) para ver o processamento.');

  } catch (error) {
    console.error('❌ Erro no teste:', error);
  } finally {
    await producer.disconnect();
    console.log('--- Fim do Teste ---');
  }
}

test();
