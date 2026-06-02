import { describe, it, expect } from 'vitest';
import { toAnthropic, fromAnthropic, toGemini, fromGemini } from '../src/index.ts';
import type { AnthropicContentBlock, GeminiPart, OpenAIMessage, Warning } from '../src/index.ts';

const audioMsg: OpenAIMessage[] = [
  { role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'AUDIO', format: 'mp3' } }] },
];

const pdf = 'UERG';
const docMsg: OpenAIMessage[] = [
  { role: 'user', content: [{ type: 'file', file: { file_data: `data:application/pdf;base64,${pdf}` } }] },
];

describe('audio', () => {
  it('maps OpenAI input_audio to Gemini inlineData and back', () => {
    const { contents } = toGemini(audioMsg);
    expect((contents[0].parts as GeminiPart[])[0]).toEqual({ inlineData: { mimeType: 'audio/mp3', data: 'AUDIO' } });
    expect(fromGemini(toGemini(audioMsg))).toEqual(audioMsg);
  });

  it('drops audio for Anthropic with a warning', () => {
    const warnings: Warning[] = [];
    const { messages } = toAnthropic(audioMsg, { onWarning: (w) => warnings.push(w) });
    expect(messages[0].content).toEqual([]);
    expect(warnings.some((w) => w.code === 'unsupported-modality')).toBe(true);
  });
});

describe('document', () => {
  it('maps an OpenAI file to an Anthropic document block and back', () => {
    const { messages } = toAnthropic(docMsg);
    expect((messages[0].content as AnthropicContentBlock[])[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf },
    });
    expect(fromAnthropic(toAnthropic(docMsg))).toEqual(docMsg);
  });

  it('maps an OpenAI file to Gemini inlineData and back', () => {
    const { contents } = toGemini(docMsg);
    expect((contents[0].parts as GeminiPart[])[0]).toEqual({
      inlineData: { mimeType: 'application/pdf', data: pdf },
    });
    expect(fromGemini(toGemini(docMsg))).toEqual(docMsg);
  });

  it('maps an OpenAI file_id to an Anthropic document file source', () => {
    const m: OpenAIMessage[] = [{ role: 'user', content: [{ type: 'file', file: { file_id: 'file_123' } }] }];
    const { messages } = toAnthropic(m);
    expect((messages[0].content as AnthropicContentBlock[])[0]).toEqual({
      type: 'document',
      source: { type: 'file', file_id: 'file_123' },
    });
  });
});
