/**
 * Type definitions for the three supported provider message formats plus the
 * shared conversion plumbing.
 *
 * The OpenAI Chat Completions format is the canonical hub: every conversion goes
 * `source -> OpenAI -> target`. The provider request shapes (Anthropic, Gemini)
 * keep the system prompt outside the message list, so they are modelled as
 * "conversation" objects rather than plain arrays.
 */

/** A supported provider. */
export type Provider = 'openai' | 'anthropic' | 'gemini';

/** Frozen, stable, machine readable codes describing non fatal conversion events. */
export const warningCodes = Object.freeze([
  'generated-id',
  'unmapped-tool-result',
  'merged-role',
  'dropped-content',
  'dropped-metadata',
  'invalid-json-arguments',
  'system-midstream',
  'gemini-url-image',
  'gemini-url-media',
  'unsupported-modality',
] as const);

/** A stable, machine readable code describing a non fatal conversion event. */
export type WarningCode = (typeof warningCodes)[number];

/** A non fatal event raised during conversion. */
export interface Warning {
  code: WarningCode;
  message: string;
}

/** Options accepted by every conversion function. */
export interface ConvertOptions {
  /** Called for each non fatal conversion event (generated id, merged turn, ...). */
  onWarning?: (warning: Warning) => void;
}

/* ------------------------------------------------------------------ */
/* OpenAI Chat Completions (canonical hub)                            */
/* ------------------------------------------------------------------ */

export interface OpenAITextPart {
  type: 'text';
  text: string;
}

export interface OpenAIImagePart {
  type: 'image_url';
  /** `url` is a remote https URL or a `data:<mediaType>;base64,<data>` data URL. */
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' | 'original' };
}

export interface OpenAIAudioPart {
  type: 'input_audio';
  /** `data` is raw base64 (no data URL prefix); `format` is `wav` or `mp3`. */
  input_audio: { data: string; format: string };
}

export interface OpenAIFilePart {
  type: 'file';
  /** `file_data` is a `data:<mediaType>;base64,<data>` data URL, or use `file_id`. */
  file: { file_data?: string; file_id?: string; filename?: string };
}

/** A content part. Unknown part types are preserved verbatim. */
export type OpenAIContentPart =
  | OpenAITextPart
  | OpenAIImagePart
  | OpenAIAudioPart
  | OpenAIFilePart
  | { type: string; [key: string]: unknown };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** Arguments as a JSON encoded string, per the OpenAI wire format. */
    arguments: string;
  };
}

export interface OpenAISystemMessage {
  /** `developer` is the o-series alias for `system`; both map to a system prompt. */
  role: 'system' | 'developer';
  content: string | OpenAITextPart[];
  name?: string;
}

export interface OpenAIUserMessage {
  role: 'user';
  content: string | OpenAIContentPart[];
  name?: string;
}

export interface OpenAIAssistantMessage {
  role: 'assistant';
  /** Text reply. `null` (or omitted) when the turn only contains tool calls. */
  content?: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolMessage {
  role: 'tool';
  tool_call_id: string;
  /** Optional provider metadata used to preserve Gemini functionResponse names. */
  name?: string;
  content: string | OpenAITextPart[];
  /** Optional provider metadata used to preserve Anthropic tool_result errors. */
  is_error?: boolean;
}

export type OpenAIMessage = OpenAISystemMessage | OpenAIUserMessage | OpenAIAssistantMessage | OpenAIToolMessage;

/* ------------------------------------------------------------------ */
/* Anthropic Messages API                                             */
/* ------------------------------------------------------------------ */

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  /** Parsed arguments object (not a JSON string). */
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | AnthropicTextBlock[];
  is_error?: boolean;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
}

export interface AnthropicDocumentBlock {
  type: 'document';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
    | { type: 'file'; file_id: string };
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock
  | AnthropicDocumentBlock
  | { type: string; [key: string]: unknown };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/** An Anthropic request body fragment: the system prompt sits outside `messages`. */
export interface AnthropicConversation {
  system?: string;
  messages: AnthropicMessage[];
}

/* ------------------------------------------------------------------ */
/* Google Gemini generateContent                                      */
/* ------------------------------------------------------------------ */

export interface GeminiTextPart {
  text: string;
}

export interface GeminiFunctionCallPart {
  functionCall: {
    id?: string;
    name: string;
    /** Parsed arguments object (not a JSON string). */
    args: Record<string, unknown>;
  };
}

export interface GeminiFunctionResponsePart {
  functionResponse: {
    id?: string;
    name: string;
    /** Result as a JSON object. Gemini has no string shorthand. */
    response: Record<string, unknown>;
  };
}

export interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string };
}

export interface GeminiFileDataPart {
  fileData: { mimeType?: string; fileUri: string };
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart
  | GeminiInlineDataPart
  | GeminiFileDataPart
  | Record<string, unknown>;

export interface GeminiContent {
  /** `model` is Gemini's name for the assistant role. */
  role?: 'user' | 'model';
  parts: GeminiPart[];
}

/** A Gemini request body fragment: `systemInstruction` sits outside `contents`. */
export interface GeminiConversation {
  systemInstruction?: GeminiContent;
  contents: GeminiContent[];
}
