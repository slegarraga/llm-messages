/* eslint-disable @typescript-eslint/no-require-imports */
// Run from the repo root after `npm run build`:
//   node examples/commonjs.cjs
const assert = require('node:assert/strict');
const { normalizeResponse, toAnthropic, warningCodes } = require('../dist/index.cjs');

const anthropic = toAnthropic([
  { role: 'system', content: 'You are concise.' },
  { role: 'user', content: 'Ping' },
]);

assert.deepEqual(anthropic, {
  system: 'You are concise.',
  messages: [{ role: 'user', content: 'Ping' }],
});

const normalized = normalizeResponse(
  {
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Pong' },
      },
    ],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  },
  { from: 'openai' },
);

assert.equal(normalized.message.content, 'Pong');
assert.equal(normalized.finishReason, 'stop');
assert.equal(Object.isFrozen(warningCodes), true);

console.log('CommonJS smoke check passed.');
