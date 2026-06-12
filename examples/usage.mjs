// Run from the repo root after `npm run build`:
//   node examples/usage.mjs
import assert from 'node:assert/strict';
import { toAnthropic, toGemini, convert } from '../dist/index.js';

const checkMode = process.argv.includes('--check');

const messages = [
  { role: 'system', content: 'You are a weather assistant.' },
  { role: 'user', content: "What's the weather in Paris?" },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Paris"}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'call_abc', content: '15C partly cloudy' },
];

const anthropic = toAnthropic(messages);
const gemini = toGemini(messages);
const converted = convert(anthropic, { from: 'anthropic', to: 'gemini' });

if (checkMode) {
  assert.equal(anthropic.system, 'You are a weather assistant.');
  assert.ok(Array.isArray(anthropic.messages));
  assert.ok(Array.isArray(gemini.contents));
  assert.ok(Array.isArray(converted.contents));
  console.log('ESM usage smoke check passed.');
  process.exit(0);
}

console.log('--- OpenAI -> Anthropic ---');
console.log(JSON.stringify(anthropic, null, 2));

console.log('\n--- OpenAI -> Gemini ---');
console.log(JSON.stringify(gemini, null, 2));

console.log('\n--- Anthropic -> Gemini (via convert) ---');
console.log(JSON.stringify(converted, null, 2));
