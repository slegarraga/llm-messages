import type { AnthropicImageBlock, GeminiPart, OpenAIImagePart } from './types.js';
import { Reporter, isRecord } from './util.js';

/**
 * A provider-neutral image. `base64` carries the raw bytes plus media type
 * (mapping to a data URL, an Anthropic base64 source or a Gemini `inlineData`
 * part); `url` carries a remote reference.
 */
export type NormalizedImage = { kind: 'base64'; mediaType: string; data: string } | { kind: 'url'; url: string };

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

/** Decomposes a `data:<mediaType>;base64,<data>` URL. Returns null otherwise. */
export function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const match = DATA_URL.exec(url);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

/** Reassembles a base64 data URL. The inverse of {@link parseDataUrl}. */
export function toDataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`;
}

/* ------------------------------- OpenAI -------------------------------- */

export function imageFromOpenAI(part: unknown): NormalizedImage | null {
  if (!isRecord(part) || part.type !== 'image_url' || !isRecord(part.image_url)) return null;
  const url = part.image_url.url;
  if (typeof url !== 'string') return null;
  const parsed = parseDataUrl(url);
  return parsed ? { kind: 'base64', ...parsed } : { kind: 'url', url };
}

export function imageToOpenAI(image: NormalizedImage): OpenAIImagePart {
  const url = image.kind === 'base64' ? toDataUrl(image.mediaType, image.data) : image.url;
  return { type: 'image_url', image_url: { url } };
}

/* ------------------------------ Anthropic ------------------------------ */

export function imageFromAnthropic(block: unknown): NormalizedImage | null {
  if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) return null;
  const source = block.source;
  if (source.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string') {
    return { kind: 'base64', mediaType: source.media_type, data: source.data };
  }
  if (source.type === 'url' && typeof source.url === 'string') {
    return { kind: 'url', url: source.url };
  }
  return null;
}

export function imageToAnthropic(image: NormalizedImage): AnthropicImageBlock {
  if (image.kind === 'base64') {
    return { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } };
  }
  return { type: 'image', source: { type: 'url', url: image.url } };
}

/* -------------------------------- Gemini ------------------------------- */

export function imageFromGemini(part: unknown): NormalizedImage | null {
  if (isRecord(part) && isRecord(part.inlineData)) {
    const data = part.inlineData;
    if (typeof data.mimeType === 'string' && typeof data.data === 'string' && data.mimeType.startsWith('image/')) {
      return { kind: 'base64', mediaType: data.mimeType, data: data.data };
    }
  }
  if (isRecord(part) && isRecord(part.fileData)) {
    const data = part.fileData;
    // A fileData with no mimeType is assumed to be an image (the only media we
    // emit as a bare fileUri); a typed non-image fileData belongs to media.ts.
    const mime = typeof data.mimeType === 'string' ? data.mimeType : '';
    if (typeof data.fileUri === 'string' && (mime === '' || mime.startsWith('image/'))) {
      return { kind: 'url', url: data.fileUri };
    }
  }
  return null;
}

export function imageToGemini(image: NormalizedImage, reporter: Reporter): GeminiPart {
  if (image.kind === 'base64') {
    return { inlineData: { mimeType: image.mediaType, data: image.data } };
  }
  // Gemini's fileData.fileUri is intended for Files API URIs, not arbitrary
  // public URLs. We emit it as a best effort and flag it so the caller can
  // upload via the Files API or inline the bytes if Gemini rejects it.
  reporter.warn(
    'gemini-url-image',
    'A remote image URL was emitted as Gemini fileData.fileUri; Gemini may require the Files API for non-Google URIs.',
  );
  return { fileData: { fileUri: image.url } };
}
