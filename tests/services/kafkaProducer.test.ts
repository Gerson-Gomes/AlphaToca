import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Definir KAFKA_BROKERS antes de importar qualquer coisa
process.env.KAFKA_BROKERS = 'localhost:9092';

import { producer } from '../../src/config/kafka';
import {
  produceEvent,
  produceWhatsAppMessage,
  produceVisitReminder,
  connectProducer,
  disconnectProducer,
  type ProduceEventOptions,
  type VisitReminderPayload,
} from '../../src/services/kafkaProducer';
import { logger } from '../../src/config/logger';
import type { WhatsAppWebhookPayload } from '../../src/types/whatsapp';

vi.mock('../../src/config/kafka');
vi.mock('../../src/config/logger');

describe('kafkaProducer.ts - produceEvent()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send a message to the specified topic', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const opts: ProduceEventOptions = {
      topic: 'test-topic',
      payload: { test: 'data' },
      key: 'test-key',
    };

    await produceEvent(opts);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      topic: 'test-topic',
      messages: [
        {
          key: 'test-key',
          value: JSON.stringify({ test: 'data' }),
          headers: {
            'content-type': 'application/json',
            'timestamp': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), // ISO 8601
          },
        },
      ],
    });
  });

  it('should handle null key by setting it to null', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const opts: ProduceEventOptions = {
      topic: 'test-topic',
      payload: { data: 'value' },
      // key não fornecido
    };

    await produceEvent(opts);

    expect(sendMock).toHaveBeenCalledWith({
      topic: 'test-topic',
      messages: [
        {
          key: null,
          value: expect.any(String),
          headers: expect.any(Object),
        },
      ],
    });
  });

  it('should log success', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;
    const logMock = vi.fn();
    vi.mocked(logger).info = logMock;

    await produceEvent({
      topic: 'test-topic',
      payload: { test: 'data' },
      key: 'key-1',
    });

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'test-topic', key: 'key-1' }),
      expect.stringContaining('successfully')
    );
  });

  it('should throw and log error on send failure', async () => {
    const sendError = new Error('Send failed');
    const sendMock = vi.fn().mockRejectedValue(sendError);
    vi.mocked(producer).send = sendMock;
    const errorLogMock = vi.fn();
    vi.mocked(logger).error = errorLogMock;

    await expect(
      produceEvent({ topic: 'test-topic', payload: { test: 'data' } })
    ).rejects.toThrow('Send failed');

    expect(errorLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ err: sendError, topic: 'test-topic' }),
      expect.stringContaining('failed')
    );
  });

  it('should serialize payload to JSON', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const complexPayload = {
      nested: { data: [1, 2, 3] },
      date: new Date('2024-01-01T00:00:00Z'),
    };

    await produceEvent({
      topic: 'test-topic',
      payload: complexPayload,
    });

    const callArgs = sendMock.mock.calls[0][0];
    const serialized = callArgs.messages[0].value;
    expect(JSON.parse(serialized)).toEqual(complexPayload);
  });
});

describe('kafkaProducer.ts - produceWhatsAppMessage()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should produce to whatsapp-messages topic with phoneNumber as key', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              value: {
                contacts: [{ wa_id: '5511999998888' }],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'msg-1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hello' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    await produceWhatsAppMessage(payload);

    expect(sendMock).toHaveBeenCalledWith({
      topic: 'whatsapp-messages',
      messages: [
        {
          key: '5511999998888',
          value: expect.stringContaining('whatsapp_business_account'),
          headers: expect.any(Object),
        },
      ],
    });
  });

  it('should use provided phoneNumber parameter as key', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              value: {
                contacts: [{ wa_id: '5511999998888' }],
              },
            },
          ],
        },
      ],
    };

    await produceWhatsAppMessage(payload, '5522888887777');

    expect(sendMock).toHaveBeenCalledWith({
      topic: 'whatsapp-messages',
      messages: [
        {
          key: '5522888887777',
          value: expect.any(String),
          headers: expect.any(Object),
        },
      ],
    });
  });

  it('should fallback to timestamp key if phoneNumber is missing', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'entry-1', changes: [{ value: {} }] }],
    };

    await produceWhatsAppMessage(payload);

    expect(sendMock).toHaveBeenCalledWith({
      topic: 'whatsapp-messages',
      messages: [
        {
          key: expect.stringMatching(/^wa-\d+$/),
          value: expect.any(String),
          headers: expect.any(Object),
        },
      ],
    });
  });

  it('should log with phoneNumber', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;
    const logMock = vi.fn();
    vi.mocked(logger).info = logMock;

    const payload: WhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              value: {
                contacts: [{ wa_id: '5511999998888' }],
              },
            },
          ],
        },
      ],
    };

    await produceWhatsAppMessage(payload);

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '5511999998888' }),
      expect.stringContaining('WhatsApp message')
    );
  });
});

describe('kafkaProducer.ts - produceVisitReminder()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should produce to visit-reminders topic', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const payload: VisitReminderPayload = { windowHours: 24 };

    await produceVisitReminder(payload);

    expect(sendMock).toHaveBeenCalledWith({
      topic: 'visit-reminders',
      messages: [
        {
          key: expect.stringMatching(/^reminder-\d+$/),
          value: JSON.stringify(payload),
          headers: expect.any(Object),
        },
      ],
    });
  });

  it('should use provided key if given', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const payload: VisitReminderPayload = { windowHours: 24 };
    const key = 'reminder-24h-custom';

    await produceVisitReminder(payload, key);

    expect(sendMock).toHaveBeenCalledWith({
      topic: 'visit-reminders',
      messages: [
        {
          key: 'reminder-24h-custom',
          value: JSON.stringify(payload),
          headers: expect.any(Object),
        },
      ],
    });
  });

  it('should log with windowHours and key', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;
    const logMock = vi.fn();
    vi.mocked(logger).info = logMock;

    const payload: VisitReminderPayload = { windowHours: 2 };

    await produceVisitReminder(payload);

    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ windowHours: 2 }),
      expect.stringContaining('visit reminder')
    );
  });

  it('should include triggeredAt if provided in payload', async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).send = sendMock;

    const now = new Date().toISOString();
    const payload: VisitReminderPayload = { windowHours: 24, triggeredAt: now };

    await produceVisitReminder(payload);

    const callArgs = sendMock.mock.calls[0][0];
    const serialized = JSON.parse(callArgs.messages[0].value);
    expect(serialized.triggeredAt).toBe(now);
  });
});

describe('kafkaProducer.ts - connectProducer() & disconnectProducer()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should connect producer', async () => {
    const connectMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).connect = connectMock;
    const logMock = vi.fn();
    vi.mocked(logger).info = logMock;

    await connectProducer();

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith(
      expect.stringContaining('connected')
    );
  });

  it('should disconnect producer', async () => {
    const disconnectMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(producer).disconnect = disconnectMock;
    const logMock = vi.fn();
    vi.mocked(logger).info = logMock;

    await disconnectProducer();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith(
      expect.stringContaining('disconnected')
    );
  });

  it('should throw on connect failure', async () => {
    const connectError = new Error('Connect failed');
    const connectMock = vi.fn().mockRejectedValue(connectError);
    vi.mocked(producer).connect = connectMock;
    const errorLogMock = vi.fn();
    vi.mocked(logger).error = errorLogMock;

    await expect(connectProducer()).rejects.toThrow('Connect failed');
    expect(errorLogMock).toHaveBeenCalled();
  });

  it('should throw on disconnect failure', async () => {
    const disconnectError = new Error('Disconnect failed');
    const disconnectMock = vi.fn().mockRejectedValue(disconnectError);
    vi.mocked(producer).disconnect = disconnectMock;
    const errorLogMock = vi.fn();
    vi.mocked(logger).error = errorLogMock;

    await expect(disconnectProducer()).rejects.toThrow('Disconnect failed');
    expect(errorLogMock).toHaveBeenCalled();
  });
});
