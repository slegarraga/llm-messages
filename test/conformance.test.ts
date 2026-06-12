import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  fromAnthropic,
  fromGemini,
  responseFromAnthropic,
  responseFromGemini,
  responseFromOpenAI,
  responseFromOpenAIResponses,
  warningCodes,
} from '../src/index.ts';
import type {
  AnthropicConversation,
  FinishReason,
  GeminiConversation,
  NormalizedResponse,
  OpenAIMessage,
  Usage,
  Warning,
  WarningCode,
} from '../src/index.ts';

const fixtureSources = [
  'anthropic',
  'anthropic-response',
  'gemini',
  'gemini-response',
  'openai',
  'openai-responses',
] as const;

type FixtureSource = (typeof fixtureSources)[number];

interface Fixture {
  name: string;
  description: string;
  source: FixtureSource;
  input: unknown;
  expectedOpenAI: OpenAIMessage[];
  expectedWarningCodes: WarningCode[];
  expectedResponse?: {
    finishReason: FinishReason;
    usage: Usage;
  };
}

interface LoadedFixture extends Fixture {
  file: string;
}

type EqualTypes<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends <Value>() => Value extends Expected ? 1 : 2 ? true : false;
type ExpectType<Condition extends true> = Condition;
const warningCodeTypeAssertions: [
  ExpectType<EqualTypes<Extract<'generated-id', WarningCode>, 'generated-id'>>,
  ExpectType<EqualTypes<Extract<'not-a-warning-code', WarningCode>, never>>,
] = [true, true];
void warningCodeTypeAssertions;

const validWarningCodes = new Set<WarningCode>(warningCodes);
const validFixtureSources = new Set<FixtureSource>(fixtureSources);
const responseFixtureSources = new Set<FixtureSource>([
  'anthropic-response',
  'gemini-response',
  'openai',
  'openai-responses',
]);
const fixtureKeys = [
  'name',
  'description',
  'source',
  'input',
  'expectedOpenAI',
  'expectedWarningCodes',
  'expectedResponse',
] as const;
const validFixtureKeys = new Set<string>(fixtureKeys);

const fixtureDir = new URL('./fixtures/', import.meta.url);
const fixtureDocs = new URL('../docs/conformance-fixtures.md', import.meta.url);
const readme = new URL('../README.md', import.meta.url);
const sourceDir = new URL('../src/', import.meta.url);
const fixtures = readdirSync(fixtureDir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => loadFixture(file))
  .sort((a, b) => a.name.localeCompare(b.name));

if (fixtures.length === 0) {
  throw new Error('conformance harness expected at least one JSON fixture.');
}

const fixtureNames = new Map<string, string>();
for (const fixture of fixtures) {
  const previousFile = fixtureNames.get(fixture.name);
  if (previousFile) {
    throw new Error(`${fixture.file}: fixture.name "${fixture.name}" duplicates ${previousFile}.`);
  }
  fixtureNames.set(fixture.name, fixture.file);
}

function loadFixture(file: string): LoadedFixture {
  const fixture = JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8')) as Partial<Fixture>;
  const unknownKeys = Object.keys(fixture).filter((key) => !validFixtureKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${file}: fixture contains unsupported top-level keys: ${unknownKeys.sort().join(', ')}.`);
  }

  if (typeof fixture.name !== 'string' || fixture.name.length === 0) {
    throw new Error(`${file}: fixture.name must be a non-empty string.`);
  }
  const expectedName = file.slice(0, -'.json'.length);
  if (fixture.name !== expectedName) {
    throw new Error(`${file}: fixture.name must match its filename "${expectedName}".`);
  }
  if (typeof fixture.description !== 'string' || fixture.description.length === 0) {
    throw new Error(`${file}: fixture.description must be a non-empty string.`);
  }
  if (!isFixtureSource(fixture.source)) {
    throw new Error(
      `${file}: fixture.source must be one of ${fixtureSources.map((source) => `"${source}"`).join(', ')}.`,
    );
  }
  if (!isRecord(fixture.input)) {
    throw new Error(`${file}: fixture.input must be an object.`);
  }
  if (fixture.source === 'anthropic' && !Array.isArray(fixture.input.messages)) {
    throw new Error(`${file}: source="anthropic" fixture.input must include a messages array.`);
  }
  if (fixture.source === 'gemini' && !Array.isArray(fixture.input.contents)) {
    throw new Error(`${file}: source="gemini" fixture.input must include a contents array.`);
  }
  if (fixture.source === 'anthropic-response' && !Array.isArray(fixture.input.content)) {
    throw new Error(`${file}: source="anthropic-response" fixture.input must include a content array.`);
  }
  if (fixture.source === 'gemini-response' && !Array.isArray(fixture.input.candidates)) {
    throw new Error(`${file}: source="gemini-response" fixture.input must include a candidates array.`);
  }
  if (fixture.source === 'openai' && !Array.isArray(fixture.input.choices)) {
    throw new Error(`${file}: source="openai" fixture.input must include a choices array.`);
  }
  if (fixture.source === 'openai-responses' && !Array.isArray(fixture.input.output)) {
    throw new Error(`${file}: source="openai-responses" fixture.input must include an output array.`);
  }
  if (!Array.isArray(fixture.expectedOpenAI)) {
    throw new Error(`${file}: fixture.expectedOpenAI must be an array.`);
  }
  if (!Array.isArray(fixture.expectedWarningCodes)) {
    throw new Error(`${file}: fixture.expectedWarningCodes must be an array.`);
  }
  if (isResponseFixtureSource(fixture.source)) {
    if (!isExpectedResponse(fixture.expectedResponse)) {
      throw new Error(`${file}: response fixtures must include expectedResponse with finishReason and usage.`);
    }
  } else if (fixture.expectedResponse !== undefined) {
    throw new Error(`${file}: expectedResponse is only supported for response fixtures.`);
  }
  for (const code of fixture.expectedWarningCodes) {
    if (!isWarningCode(code)) {
      throw new Error(`${file}: fixture.expectedWarningCodes contains unsupported code "${String(code)}".`);
    }
  }

  return { ...fixture, file } as LoadedFixture;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWarningCode(value: unknown): value is WarningCode {
  return typeof value === 'string' && validWarningCodes.has(value as WarningCode);
}

function isFixtureSource(value: unknown): value is FixtureSource {
  return typeof value === 'string' && validFixtureSources.has(value as FixtureSource);
}

function isResponseFixtureSource(value: FixtureSource): boolean {
  return responseFixtureSources.has(value);
}

function isExpectedResponse(value: unknown): value is { finishReason: FinishReason; usage: Usage } {
  if (!isRecord(value)) return false;
  const usage = value.usage;
  return (
    typeof value.finishReason === 'string' &&
    ['stop', 'tool_calls', 'length', 'content_filter', 'unknown'].includes(value.finishReason) &&
    isRecord(usage) &&
    typeof usage.inputTokens === 'number' &&
    typeof usage.outputTokens === 'number'
  );
}

function parseInventoryWarningCodes(value: string): WarningCode[] {
  if (value === 'none') return [];

  const repeated = value.match(/^(\d+)x `([^`]+)`$/);
  if (repeated) {
    const count = Number(repeated[1]);
    const code = repeated[2];
    if (!Number.isInteger(count) || count < 1 || !isWarningCode(code)) {
      throw new Error(`Invalid fixture inventory warning-code cell "${value}".`);
    }
    return Array.from({ length: count }, () => code);
  }

  const codes: WarningCode[] = [];
  for (const match of value.matchAll(/`([^`]+)`/g)) {
    const code = match[1];
    if (!isWarningCode(code)) {
      throw new Error(`Invalid fixture inventory warning-code cell "${value}".`);
    }
    codes.push(code);
  }
  if (codes.length === 0) {
    throw new Error(`Invalid fixture inventory warning-code cell "${value}".`);
  }
  return codes;
}

function parseFixtureInventory(): Map<
  string,
  { source: FixtureSource; description: string; warningCodes: WarningCode[] }
> {
  const rows = readFileSync(fixtureDocs, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('| `'));
  const inventory = new Map<string, { source: FixtureSource; description: string; warningCodes: WarningCode[] }>();

  for (const row of rows) {
    const [nameCell, sourceCell, descriptionCell, warningsCell] = row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const name = nameCell?.match(/^`([^`]+)`$/)?.[1];
    const source = sourceCell?.match(/^`([^`]+)`$/)?.[1];
    if (!name || !isFixtureSource(source) || !descriptionCell || !warningsCell) {
      throw new Error(`Invalid fixture inventory row "${row}".`);
    }
    if (inventory.has(name)) {
      throw new Error(`Duplicate fixture inventory row for "${name}".`);
    }
    inventory.set(name, {
      source,
      description: descriptionCell,
      warningCodes: parseInventoryWarningCodes(warningsCell),
    });
  }

  return inventory;
}

function parseReadmeWarningCodes(): WarningCode[] {
  const text = readFileSync(readme, 'utf8');
  const match = text.match(/Warning codes: ([\s\S]*?)\.\n/);
  if (!match) throw new Error('README warning-code list not found.');

  const codes: WarningCode[] = [];
  for (const codeMatch of match[1].matchAll(/`([^`]+)`/g)) {
    const code = codeMatch[1];
    if (!isWarningCode(code)) {
      throw new Error(`README warning-code list contains unsupported code "${code}".`);
    }
    codes.push(code);
  }
  return codes;
}

function listTypeScriptFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const child = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
      if (entry.isDirectory()) return listTypeScriptFiles(child);
      return entry.isFile() && entry.name.endsWith('.ts') ? [child] : [];
    })
    .sort((a, b) => a.href.localeCompare(b.href));
}

function parseSourceWarningCodes(): { code: string; file: string }[] {
  return listTypeScriptFiles(sourceDir).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/\breporter\.warn\(\s*'([^']+)'/g)].map((match) => ({
      code: match[1],
      file: fileURLToPath(file),
    }));
  });
}

function parseFixtureContractKeys(): string[] {
  const text = readFileSync(fixtureDocs, 'utf8');
  const section = text.match(/Every committed fixture should include:\n\n([\s\S]*?)\n\nFuture fixture classes/)?.[1];
  if (!section) throw new Error('Fixture contract section not found.');

  return [...section.matchAll(/^- `([^`]+)`:/gm)].map((match) => match[1]);
}

describe('conformance fixtures', () => {
  it('covers every provider message and response source', () => {
    expect(new Set(fixtures.map((fixture) => fixture.source))).toEqual(new Set(fixtureSources));
  });

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const warnings: Warning[] = [];

      const out = normalizeFixture(fixture, {
        onWarning: (warning) => warnings.push(warning),
      });

      expect(out.messages).toEqual(fixture.expectedOpenAI);
      if (fixture.expectedResponse) {
        expect(out.response).toBeDefined();
        expect(out.response?.finishReason).toBe(fixture.expectedResponse.finishReason);
        expect(out.response?.usage).toEqual(fixture.expectedResponse.usage);
      } else {
        expect(out.response).toBeUndefined();
      }
      expect(warnings.map((warning) => warning.code)).toEqual(fixture.expectedWarningCodes);
      expect(warnings).toHaveLength(fixture.expectedWarningCodes.length);
      for (const [index, warning] of warnings.entries()) {
        expect(warning).toEqual({
          code: fixture.expectedWarningCodes[index],
          message: expect.any(String),
        });
        expect(warning.message.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('conformance fixture docs', () => {
  it('keeps the fixture contract keys aligned with the harness schema', () => {
    expect(parseFixtureContractKeys()).toEqual([...fixtureKeys]);
  });

  it('keeps the fixture inventory aligned with committed fixtures', () => {
    const inventory = parseFixtureInventory();

    expect([...inventory.keys()].sort()).toEqual(fixtures.map((fixture) => fixture.name));
    expect([...inventory.keys()]).toEqual(fixtures.map((fixture) => fixture.name));
    for (const fixture of fixtures) {
      const row = inventory.get(fixture.name);
      expect(row?.source).toBe(fixture.source);
      expect(row?.description).toBe(fixture.description);
      expect(row?.warningCodes).toEqual(fixture.expectedWarningCodes);
    }
  });

  it('keeps OpenAI fixture descriptions aligned with the source surface', () => {
    const inventory = parseFixtureInventory();

    for (const [name, row] of inventory) {
      if (row.source === 'openai') {
        expect({ name, description: row.description }).toMatchObject({
          description: expect.stringContaining('Chat Completions'),
        });
        expect({ name, description: row.description }).not.toMatchObject({
          description: expect.stringContaining('Responses API'),
        });
      }

      if (row.source === 'openai-responses') {
        expect({ name, description: row.description }).toMatchObject({
          description: expect.stringContaining('Responses API'),
        });
      }
    }
  });
});

describe('warningCodes', () => {
  it('exports the documented warning-code values', () => {
    expect(Object.isFrozen(warningCodes)).toBe(true);
    expect(warningCodes).toEqual([
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
    ]);
  });

  it('keeps the README warning-code list aligned with the public export', () => {
    expect(parseReadmeWarningCodes()).toEqual(warningCodes);
  });

  it('keeps source warning emissions aligned with the public export', () => {
    const emitted = parseSourceWarningCodes();
    const unsupported = emitted.filter(({ code }) => !isWarningCode(code));
    const emittedCodes = [...new Set(emitted.map(({ code }) => code))].sort();

    expect(emitted.length).toBeGreaterThan(0);
    expect(unsupported).toEqual([]);
    expect(emittedCodes).toEqual([...warningCodes].sort());
  });
});

function normalizeFixture(
  fixture: LoadedFixture,
  options: { onWarning: (warning: Warning) => void },
): { messages: OpenAIMessage[]; response?: NormalizedResponse } {
  switch (fixture.source) {
    case 'anthropic':
      return { messages: fromAnthropic(fixture.input as AnthropicConversation, options) };
    case 'anthropic-response':
      return responseFixture(responseFromAnthropic(fixture.input, options));
    case 'gemini':
      return { messages: fromGemini(fixture.input as GeminiConversation, options) };
    case 'gemini-response':
      return responseFixture(responseFromGemini(fixture.input, options));
    case 'openai':
      return responseFixture(responseFromOpenAI(fixture.input, options));
    case 'openai-responses':
      return responseFixture(responseFromOpenAIResponses(fixture.input, options));
  }
}

function responseFixture(response: NormalizedResponse): { messages: OpenAIMessage[]; response: NormalizedResponse } {
  return { messages: [response.message], response };
}
