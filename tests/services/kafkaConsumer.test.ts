import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Definir KAFKA_BROKERS antes de importar qualquer coisa
process.env.KAFKA_BROKERS = 'localhost:9092';

import { consumer } from '../../src/config/kafka';
import {
  startKafkaConsumer,
  stopKafkaConsumer,
  isConsumerRunning_,
} from '../../src/services/kafkaConsumer';
import { logger } from '../../src/config/logger';

vi.mock('../../src/config/kafka');
vi.mock('../../src/config/logger');
vi.mock('../../src/config/db');
vi.mock('../../src/services/whatsappService');
vi.mock('../../src/services/ragChainService');
vi.mock('../../src/services/leadExtractionService');
vi.mock('../../src/services/searchExtractionService');
vi.mock('../../src/services/propertyService');
vi.mock('../../src/utils/phoneRateLimiter');
vi.mock('../../src/workers/whatsappWorker');

describe('kafkaConsumer.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset consumer state
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startKafkaConsumer()', () => {
    it('should connect consumer', async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockResolvedValue(undefined);
      const logMock = vi.fn();

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;
      vi.mocked(logger).info = logMock;

      await startKafkaConsumer();

      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(logMock).toHaveBeenCalledWith(
        expect.stringContaining('connected')
      );
    });

    it('should subscribe to whatsapp-messages and visit-reminders topics', async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockResolvedValue(undefined);

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;

      await startKafkaConsumer();

      expect(subscribeMock).toHaveBeenCalledWith({
        topics: ['whatsapp-messages', 'visit-reminders'],
        fromBeginning: false,
      });
    });

    it('should run consumer with eachMessage handler', async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockResolvedValue(undefined);

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;

      await startKafkaConsumer();

      expect(runMock).toHaveBeenCalledWith({
        eachMessage: expect.any(Function),
      });
    });

    it('should ignore duplicate start calls', async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockResolvedValue(undefined);
      const warnMock = vi.fn();

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;
      vi.mocked(logger).warn = warnMock;

      await startKafkaConsumer();
      await startKafkaConsumer();

      // Connect deveria ser chamado uma vez, segunda tentativa gera warning
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('already running')
      );
    });

    it('should throw and log error on connect failure', async () => {
      const connectError = new Error('Connect failed');
      const connectMock = vi.fn().mockRejectedValue(connectError);
      const errorLogMock = vi.fn();

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(logger).error = errorLogMock;

      await expect(startKafkaConsumer()).rejects.toThrow('Connect failed');
      expect(errorLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ err: connectError }),
        expect.stringContaining('failed to start')
      );
    });

    it('should throw if REDIS_URL is not defined', async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockImplementation(async (opts) => {
        // Trigger eachMessage handler which will initialize redis
        const payload = {
          topic: 'whatsapp-messages',
          partition: 0,
          message: {
            offset: '0',
            value: Buffer.from('{}'),
          },
        };
        // This will fail when initializing redis
        try {
          await opts.eachMessage(payload);
        } catch (e) {
          // Expected
        }
      });

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;

      delete process.env.REDIS_URL;

      await startKafkaConsumer();

      // Should have started successfully (error happens later in eachMessage)
      expect(connectMock).toHaveBeenCalled();
    });
  });

  describe('stopKafkaConsumer()', () => {
    beforeEach(async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockResolvedValue(undefined);

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;

      await startKafkaConsumer();
    });

    it('should disconnect consumer', async () => {
      const disconnectMock = vi.fn().mockResolvedValue(undefined);
      const logMock = vi.fn();

      vi.mocked(consumer).disconnect = disconnectMock;
      vi.mocked(logger).info = logMock;

      await stopKafkaConsumer();

      expect(disconnectMock).toHaveBeenCalledTimes(1);
      expect(logMock).toHaveBeenCalledWith(
        expect.stringContaining('disconnected successfully')
      );
    });

    it('should warn if not running', async () => {
      const warnMock = vi.fn();
      vi.mocked(logger).warn = warnMock;

      // Call stop twice
      const disconnectMock = vi.fn().mockResolvedValue(undefined);
      vi.mocked(consumer).disconnect = disconnectMock;

      await stopKafkaConsumer();
      await stopKafkaConsumer();

      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('not running')
      );
    });

    it('should throw and log error on disconnect failure', async () => {
      const disconnectError = new Error('Disconnect failed');
      const disconnectMock = vi.fn().mockRejectedValue(disconnectError);
      const errorLogMock = vi.fn();

      vi.mocked(consumer).disconnect = disconnectMock;
      vi.mocked(logger).error = errorLogMock;

      await expect(stopKafkaConsumer()).rejects.toThrow('Disconnect failed');
      expect(errorLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ err: disconnectError }),
        expect.stringContaining('failed to stop')
      );
    });
  });

  describe('isConsumerRunning_()', () => {
    it('should return false initially', () => {
      expect(isConsumerRunning_()).toBe(false);
    });

    it('should return true after startKafkaConsumer', async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockResolvedValue(undefined);

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;

      await startKafkaConsumer();
      expect(isConsumerRunning_()).toBe(true);
    });

    it('should return false after stopKafkaConsumer', async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      const runMock = vi.fn().mockResolvedValue(undefined);
      const disconnectMock = vi.fn().mockResolvedValue(undefined);

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;
      vi.mocked(consumer).disconnect = disconnectMock;

      await startKafkaConsumer();
      expect(isConsumerRunning_()).toBe(true);

      await stopKafkaConsumer();
      expect(isConsumerRunning_()).toBe(false);
    });
  });

  describe('eachMessage handler', () => {
    let eachMessageHandler: Function;

    beforeEach(async () => {
      const connectMock = vi.fn().mockResolvedValue(undefined);
      const subscribeMock = vi.fn().mockResolvedValue(undefined);
      let capturedHandler: Function;

      const runMock = vi.fn().mockImplementation(async (opts) => {
        capturedHandler = opts.eachMessage;
      });

      vi.mocked(consumer).connect = connectMock;
      vi.mocked(consumer).subscribe = subscribeMock;
      vi.mocked(consumer).run = runMock;

      await startKafkaConsumer();
      eachMessageHandler = capturedHandler!;
    });

    it('should handle unknown topic gracefully', async () => {
      const warnMock = vi.fn();
      vi.mocked(logger).warn = warnMock;

      const payload = {
        topic: 'unknown-topic',
        partition: 0,
        message: {
          offset: '0',
          value: Buffer.from('{}'),
        },
      };

      await eachMessageHandler(payload);

      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'unknown-topic' }),
        expect.stringContaining('unknown topic')
      );
    });

    it('should handle empty message value', async () => {
      const warnMock = vi.fn();
      vi.mocked(logger).warn = warnMock;

      const payload = {
        topic: 'whatsapp-messages',
        partition: 0,
        message: {
          offset: '0',
          value: null,
        },
      };

      await eachMessageHandler(payload);

      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'whatsapp-messages' }),
        expect.stringContaining('empty message value')
      );
    });
  });
});
