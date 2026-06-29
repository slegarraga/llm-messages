import type {
  AnthropicDocumentBlock,
  GeminiPart,
  OpenAIAudioPart,
  OpenAIContentPart,
  OpenAIFilePart,
} from './types.js';
import { Reporter, isRecord } from './util.js';
import { parseDataUrl, toDataUrl } from './image.js';

/**
 * A provider-neutral non-image media part (audio or document). Images keep their
 * own dedicated path in `image.ts`; everything else flows through here.
 */
export type MediaModality = 'audio' | 'document';

export type MediaSource =
  { kind: 'base64'; mediaType: string; data: string } | { kind: 'url'; url: string } | { kind: 'file_id'; id: string };

export interface MediaPart {
  modality: MediaModality;
  source: MediaSource;
  filename?: string;
}

function modalityFromMime(mediaType: string): MediaModality {
  return mediaType.startsWith('audio/') ? 'audio' : 'document';
}

/* -------------------------------- OpenAI ------------------------------- */

export function mediaFromOpenAI(part: unknown): MediaPart | null {
  if (!isRecord(part)) return null;

  if (part.type === 'input_audio' && isRecord(part.input_audio)) {
    const audio = part.input_audio;
    if (typeof audio.data === 'string') {
      const format = typeof audio.format === 'string' ? audio.format : 'wav';
      return { modality: 'audio', source: { kind: 'base64', mediaType: `audio/${format}`, data: audio.data } };
    }
  }

  if (part.type === 'file' && isRecord(part.file)) {
    const file = part.file;
    const filename = typeof file.filename === 'string' ? file.filename : undefined;
    if (typeof file.file_data === 'string') {
      const parsed = parseDataUrl(file.file_data);
      if (parsed) return { modality: 'document', source: { kind: 'base64', ...parsed }, filename };
    }
    if (typeof file.file_id === 'string') {
      return { modality: 'document', source: { kind: 'file_id', id: file.file_id }, filename };
    }
  }

  return null;
}

export function mediaToOpenAI(media: MediaPart): OpenAIContentPart | null {
  const { modality, source } = media;
  if (modality === 'audio') {
    if (source.kind !== 'base64') return null; // Chat Completions has no URL/id audio input
    const audio: OpenAIAudioPart = {
      type: 'input_audio',
      input_audio: { data: source.data, format: source.mediaType.replace(/^audio\//, '') },
    };
    return audio;
  }
  // document
  if (source.kind === 'base64') {
    const file: OpenAIFilePart = {
      type: 'file',
      file: {
        file_data: toDataUrl(source.mediaType, source.data),
        ...(media.filename ? { filename: media.filename } : {}),
      },
    };
    return file;
  }
  if (source.kind === 'file_id') {
    const file: OpenAIFilePart = {
      type: 'file',
      file: { file_id: source.id, ...(media.filename ? { filename: media.filename } : {}) },
    };
    return file;
  }
  return null; // Chat Completions has no URL document input
}

/* ------------------------------- Anthropic ----------------------------- */

export function mediaFromAnthropic(block: unknown): MediaPart | null {
  if (!isRecord(block) || block.type !== 'document' || !isRecord(block.source)) return null;
  const source = block.source;
  if (source.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string') {
    return { modality: 'document', source: { kind: 'base64', mediaType: source.media_type, data: source.data } };
  }
  if (source.type === 'url' && typeof source.url === 'string') {
    return { modality: 'document', source: { kind: 'url', url: source.url } };
  }
  if (source.type === 'file' && typeof source.file_id === 'string') {
    return { modality: 'document', source: { kind: 'file_id', id: source.file_id } };
  }
  return null;
}

export function mediaToAnthropic(media: MediaPart, reporter: Reporter): AnthropicDocumentBlock | null {
  if (media.modality === 'audio') {
    reporter.warn('unsupported-modality', 'Anthropic has no audio input; dropped an audio part.');
    return null;
  }
  const { source } = media;
  if (source.kind === 'base64') {
    return { type: 'document', source: { type: 'base64', media_type: source.mediaType, data: source.data } };
  }
  if (source.kind === 'url') {
    return { type: 'document', source: { type: 'url', url: source.url } };
  }
  return { type: 'document', source: { type: 'file', file_id: source.id } };
}

/* -------------------------------- Gemini ------------------------------- */

export function mediaFromGemini(part: unknown): MediaPart | null {
  if (isRecord(part) && isRecord(part.inlineData)) {
    const data = part.inlineData;
    if (typeof data.mimeType === 'string' && typeof data.data === 'string' && !data.mimeType.startsWith('image/')) {
      return {
        modality: modalityFromMime(data.mimeType),
        source: { kind: 'base64', mediaType: data.mimeType, data: data.data },
      };
    }
  }
  if (isRecord(part) && isRecord(part.fileData)) {
    const data = part.fileData;
    const mime = typeof data.mimeType === 'string' ? data.mimeType : '';
    // A bare fileUri (no mimeType) is treated as an image in image.ts.
    if (typeof data.fileUri === 'string' && mime !== '' && !mime.startsWith('image/')) {
      return { modality: modalityFromMime(mime), source: { kind: 'url', url: data.fileUri } };
    }
  }
  return null;
}

export function mediaToGemini(media: MediaPart, reporter: Reporter): GeminiPart | null {
  const { source } = media;
  if (source.kind === 'base64') {
    return { inlineData: { mimeType: source.mediaType, data: source.data } };
  }
  if (source.kind === 'url') {
    reporter.warn(
      'gemini-url-media',
      'A media URL was emitted as Gemini fileData.fileUri; Gemini may require the Files API for non-Google URIs.',
    );
    return { fileData: { fileUri: source.url } };
  }
  reporter.warn('unsupported-modality', 'Gemini has no file-id media reference; dropped a file_id part.');
  return null;
}
