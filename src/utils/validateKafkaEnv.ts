/**
 * Validação de variáveis de ambiente Kafka
 * Importar no app.ts para garantir que todas as vars necessárias estão definidas
 */

export interface KafkaEnvConfig {
  KAFKA_BROKERS: string;
  KAFKA_PRODUCER_TIMEOUT?: number;
  KAFKA_CONSUMER_SESSION_TIMEOUT?: number;
  KAFKA_CONSUMER_HEARTBEAT_INTERVAL?: number;
}

/**
 * Valida e retorna configurações Kafka do ambiente
 * @throws Error se KAFKA_BROKERS não estiver definida
 */
export function validateKafkaEnv(): KafkaEnvConfig {
  const kafkaBrokers = process.env.KAFKA_BROKERS?.trim();

  if (!kafkaBrokers) {
    throw new Error(
      `[Kafka Env Validation] KAFKA_BROKERS is required. Format: "localhost:9092" or "broker1:9092,broker2:9092"`
    );
  }

  // Validar formato dos brokers
  const brokers = kafkaBrokers.split(',').map((b) => b.trim());
  for (const broker of brokers) {
    if (!broker.includes(':')) {
      throw new Error(
        `[Kafka Env Validation] Invalid broker format: "${broker}". Expected "host:port"`
      );
    }
    const [host, port] = broker.split(':');
    const portNum = Number.parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error(
        `[Kafka Env Validation] Invalid port for broker "${broker}": ${port} (expected 1-65535)`
      );
    }
  }

  return {
    KAFKA_BROKERS: kafkaBrokers,
    KAFKA_PRODUCER_TIMEOUT: process.env.KAFKA_PRODUCER_TIMEOUT
      ? Number.parseInt(process.env.KAFKA_PRODUCER_TIMEOUT, 10)
      : undefined,
    KAFKA_CONSUMER_SESSION_TIMEOUT: process.env.KAFKA_CONSUMER_SESSION_TIMEOUT
      ? Number.parseInt(process.env.KAFKA_CONSUMER_SESSION_TIMEOUT, 10)
      : undefined,
    KAFKA_CONSUMER_HEARTBEAT_INTERVAL: process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL
      ? Number.parseInt(process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL, 10)
      : undefined,
  };
}

/**
 * Log das configurações Kafka (sem expor senhas)
 */
export function logKafkaConfig(): void {
  const config = validateKafkaEnv();
  console.log('[Kafka Env] Configuration validated:');
  console.log(`  - Brokers: ${config.KAFKA_BROKERS}`);
  console.log(`  - Producer Timeout: ${config.KAFKA_PRODUCER_TIMEOUT ?? 30000}ms`);
  console.log(`  - Consumer Session Timeout: ${config.KAFKA_CONSUMER_SESSION_TIMEOUT ?? 20000}ms`);
  console.log(`  - Consumer Heartbeat Interval: ${config.KAFKA_CONSUMER_HEARTBEAT_INTERVAL ?? 3000}ms`);
}
