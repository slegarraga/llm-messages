// Run from the repo root after `npm run build`:
//   node examples/usage.mjs
import { toAnthropic, toGemini, convert } from '../dist/index.js';

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

console.log('--- OpenAI -> Anthropic ---');
console.log(JSON.stringify(toAnthropic(messages), null, 2));

console.log('\n--- OpenAI -> Gemini ---');
console.log(JSON.stringify(toGemini(messages), null, 2));

console.log('\n--- Anthropic -> Gemini (via convert) ---');
const anthropic = toAnthropic(messages);
console.log(JSON.stringify(convert(anthropic, { from: 'anthropic', to: 'gemini' }), null, 2));
