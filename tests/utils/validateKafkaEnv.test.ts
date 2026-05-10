import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateKafkaEnv, logKafkaConfig } from '../src/utils/validateKafkaEnv';

describe('validateKafkaEnv - src/utils/validateKafkaEnv.ts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Preservar env original
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restaurar env
    process.env = originalEnv;
  });

  describe('validateKafkaEnv()', () => {
    it('should throw error if KAFKA_BROKERS is not defined', () => {
      delete process.env.KAFKA_BROKERS;

      expect(() => validateKafkaEnv()).toThrow('[Kafka Env Validation] KAFKA_BROKERS is required');
    });

    it('should throw error if KAFKA_BROKERS is empty string', () => {
      process.env.KAFKA_BROKERS = '';

      expect(() => validateKafkaEnv()).toThrow('[Kafka Env Validation] KAFKA_BROKERS is required');
    });

    it('should throw error if KAFKA_BROKERS has only whitespace', () => {
      process.env.KAFKA_BROKERS = '   ';

      expect(() => validateKafkaEnv()).toThrow('[Kafka Env Validation] KAFKA_BROKERS is required');
    });

    it('should parse single broker correctly', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';

      const config = validateKafkaEnv();

      expect(config.KAFKA_BROKERS).toBe('localhost:9092');
    });

    it('should parse multiple brokers correctly', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9093,broker3:9094';

      const config = validateKafkaEnv();

      expect(config.KAFKA_BROKERS).toBe('broker1:9092,broker2:9093,broker3:9094');
    });

    it('should trim whitespace from brokers', () => {
      process.env.KAFKA_BROKERS = ' localhost:9092 , broker2:9093 ';

      const config = validateKafkaEnv();

      expect(config.KAFKA_BROKERS).toContain('localhost:9092');
      expect(config.KAFKA_BROKERS).toContain('broker2:9093');
    });

    it('should throw error if broker format is invalid (no port)', () => {
      process.env.KAFKA_BROKERS = 'localhost';

      expect(() => validateKafkaEnv()).toThrow('Invalid broker format');
    });

    it('should throw error if port is invalid (NaN)', () => {
      process.env.KAFKA_BROKERS = 'localhost:abc';

      expect(() => validateKafkaEnv()).toThrow('Invalid port');
    });

    it('should throw error if port is out of range (too low)', () => {
      process.env.KAFKA_BROKERS = 'localhost:0';

      expect(() => validateKafkaEnv()).toThrow('Invalid port');
    });

    it('should throw error if port is out of range (too high)', () => {
      process.env.KAFKA_BROKERS = 'localhost:70000';

      expect(() => validateKafkaEnv()).toThrow('Invalid port');
    });

    it('should accept valid port range (1-65535)', () => {
      const validPorts = ['1', '80', '443', '9092', '65535'];

      validPorts.forEach((port) => {
        process.env.KAFKA_BROKERS = `localhost:${port}`;
        expect(() => validateKafkaEnv()).not.toThrow();
      });
    });

    it('should parse producer timeout from env', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_PRODUCER_TIMEOUT = '45000';

      const config = validateKafkaEnv();

      expect(config.KAFKA_PRODUCER_TIMEOUT).toBe(45000);
    });

    it('should use undefined for producer timeout if not set', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      delete process.env.KAFKA_PRODUCER_TIMEOUT;

      const config = validateKafkaEnv();

      expect(config.KAFKA_PRODUCER_TIMEOUT).toBeUndefined();
    });

    it('should parse consumer session timeout from env', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CONSUMER_SESSION_TIMEOUT = '25000';

      const config = validateKafkaEnv();

      expect(config.KAFKA_CONSUMER_SESSION_TIMEOUT).toBe(25000);
    });

    it('should parse consumer heartbeat interval from env', () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL = '5000';

      const config = validateKafkaEnv();

      expect(config.KAFKA_CONSUMER_HEARTBEAT_INTERVAL).toBe(5000);
    });

    it('should return all config values correctly', () => {
      process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';
      process.env.KAFKA_PRODUCER_TIMEOUT = '30000';
      process.env.KAFKA_CONSUMER_SESSION_TIMEOUT = '20000';
      process.env.KAFKA_CONSUMER_HEARTBEAT_INTERVAL = '3000';

      const config = validateKafkaEnv();

      expect(config).toEqual({
        KAFKA_BROKERS: 'broker1:9092,broker2:9092',
        KAFKA_PRODUCER_TIMEOUT: 30000,
        KAFKA_CONSUMER_SESSION_TIMEOUT: 20000,
        KAFKA_CONSUMER_HEARTBEAT_INTERVAL: 3000,
      });
    });
  });

  describe('logKafkaConfig()', () => {
    beforeEach(() => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
    });

    it('should not throw error', () => {
      expect(() => logKafkaConfig()).not.toThrow();
    });

    it('should log configuration without exposing secrets', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logKafkaConfig();

      // Verificar que não logs contêm 'password' ou outros secrets
      consoleSpy.mock.calls.forEach((call) => {
        expect(call[0]).not.toMatch(/password|secret|key/i);
      });

      consoleSpy.mockRestore();
    });

    it('should output broker information', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logKafkaConfig();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Brokers');
      expect(output).toContain('localhost:9092');

      consoleSpy.mockRestore();
    });
  });
});
