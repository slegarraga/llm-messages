import { describe, it, expect } from 'vitest';
import { toAnthropic, fromAnthropic, toGemini, fromGemini, parseDataUrl, toDataUrl } from '../src/index.ts';
import type { AnthropicContentBlock, GeminiPart, OpenAIMessage, Warning } from '../src/index.ts';

const png = 'iVBORw0KGgoAAAANSUhEUg==';
const dataUrl = `data:image/png;base64,${png}`;

const base64Image: OpenAIMessage[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  },
];

const urlImage: OpenAIMessage[] = [
  { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/p.jpg' } }] },
];

describe('data url helpers', () => {
  it('parses and rebuilds losslessly', () => {
    expect(parseDataUrl(dataUrl)).toEqual({ mediaType: 'image/png', data: png });
    expect(toDataUrl('image/png', png)).toBe(dataUrl);
  });

  it('returns null for non data urls', () => {
    expect(parseDataUrl('https://example.com/y.png')).toBeNull();
  });
});

describe('base64 image', () => {
  it('round trips OpenAI -> Anthropic -> OpenAI', () => {
    expect(fromAnthropic(toAnthropic(base64Image))).toEqual(base64Image);
  });

  it('round trips OpenAI -> Gemini -> OpenAI', () => {
    expect(fromGemini(toGemini(base64Image))).toEqual(base64Image);
  });

  it('produces an Anthropic base64 image block', () => {
    const { messages } = toAnthropic(base64Image);
    expect(messages[0].content as AnthropicContentBlock[]).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: png },
    });
  });

  it('produces a Gemini inlineData part', () => {
    const { contents } = toGemini(base64Image);
    expect(contents[0].parts as GeminiPart[]).toContainEqual({ inlineData: { mimeType: 'image/png', data: png } });
  });
});

describe('remote url image', () => {
  it('maps to an Anthropic url source', () => {
    const { messages } = toAnthropic(urlImage);
    expect((messages[0].content as AnthropicContentBlock[])[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/p.jpg' },
    });
  });

  it('emits Gemini fileData and warns it may need the Files API', () => {
    const warnings: Warning[] = [];
    const { contents } = toGemini(urlImage, { onWarning: (w) => warnings.push(w) });
    expect((contents[0].parts as GeminiPart[])[0]).toEqual({ fileData: { fileUri: 'https://example.com/p.jpg' } });
    expect(warnings.some((w) => w.code === 'gemini-url-image')).toBe(true);
  });

  it('round trips a url through Anthropic', () => {
    expect(fromAnthropic(toAnthropic(urlImage))).toEqual(urlImage);
  });
});
