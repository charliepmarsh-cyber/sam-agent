import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zodFromOpenApi, classifyEndpoint } from '../src/skills/discover.ts';

test('zodFromOpenApi: object with required/optional, nested array, nullable union', () => {
  const schema = zodFromOpenApi({
    type: 'object',
    required: ['transactions', 'next_cursor'],
    properties: {
      transactions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['transaction_id', 'amount'],
          properties: { transaction_id: { type: 'string' }, amount: { type: 'number' }, note: { type: 'string' } },
        },
      },
      next_cursor: { type: ['string', 'null'] },
    },
  });
  const good = schema.safeParse({ transactions: [{ transaction_id: 'T1', amount: 5 }], next_cursor: null });
  assert.ok(good.success);
  const badMissing = schema.safeParse({ transactions: [{ amount: 5 }], next_cursor: null });
  assert.ok(!badMissing.success, 'missing required nested field must fail');
  const badType = schema.safeParse({ transactions: [{ transaction_id: 'T1', amount: 'five' }], next_cursor: 'abc' });
  assert.ok(!badType.success, 'wrong type must fail');
});

test('zodFromOpenApi: integer bounds from the spec are enforced', () => {
  const schema = zodFromOpenApi({ type: 'integer', minimum: 1, maximum: 100 });
  assert.ok(schema.safeParse(100).success);
  assert.ok(!schema.safeParse(101).success);
  assert.ok(!schema.safeParse(2.5).success);
});

test('zodFromOpenApi: extra fields tolerated, unknown schema stays unknown', () => {
  const schema = zodFromOpenApi({ type: 'object', required: ['a'], properties: { a: { type: 'string' } } });
  assert.ok(schema.safeParse({ a: 'x', extra: 42 }).success, 'loose object must tolerate extras');
  assert.ok(zodFromOpenApi(undefined).safeParse('anything').success);
});

test('endpoint policy: GETs callable, payment POSTs refused, other writes refused', () => {
  assert.equal(classifyEndpoint('get', '/transactions').callable, true);
  assert.equal(classifyEndpoint('get', '/balance').callable, true);
  const payment = classifyEndpoint('post', '/payments/initiate');
  assert.equal(payment.callable, false);
  assert.match(payment.policyNote, /never autonomous/i);
  assert.equal(classifyEndpoint('post', '/webhooks').callable, false);
});
