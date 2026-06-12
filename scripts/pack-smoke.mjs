import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tempRoot = mkdtempSync(join(tmpdir(), 'llm-messages-pack-smoke-'));
const tscBin = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
}

function parsePackJson(stdout) {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`npm pack did not emit JSON output: ${stdout}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

const requiredPackageFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'ROADMAP.md',
  'SECURITY.md',
  'dist/index.js',
  'dist/index.js.map',
  'dist/index.cjs',
  'dist/index.cjs.map',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'docs/adoption-guide.md',
  'docs/conformance-fixtures.md',
  'docs/security-posture.md',
  'examples/commonjs.cjs',
  'examples/usage.mjs',
];

const sourceMapPackageFiles = ['dist/index.js.map', 'dist/index.cjs.map'];
const expectedWarningCodes = [
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
];
const expectedWarningCodesJson = JSON.stringify(expectedWarningCodes);
const requiredPackageKeywords = [
  'openai',
  'anthropic',
  'gemini',
  'provider-portability',
  'structured-outputs',
  'multimodal',
  'typescript',
  'zero-dependencies',
];

const privatePackagePrefixes = ['src/', 'test/', 'scripts/', '.github/'];
const privatePackageFiles = ['package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'eslint.config.js'];
const privateSourceMapMarkers = [repoRoot, process.env.HOME]
  .filter((marker) => typeof marker === 'string' && marker.length > 0)
  .map((marker) => marker.replaceAll('\\', '/'));

function assertPackageContents(packEntry) {
  const files = Array.isArray(packEntry.files) ? packEntry.files : [];
  const paths = files
    .map((file) => file.path)
    .filter((path) => typeof path === 'string')
    .sort();

  const missingFiles = requiredPackageFiles.filter((path) => !paths.includes(path));
  if (missingFiles.length > 0) {
    throw new Error(`npm pack output is missing required files: ${missingFiles.join(', ')}`);
  }

  const privateFiles = paths.filter(
    (path) => privatePackageFiles.includes(path) || privatePackagePrefixes.some((prefix) => path.startsWith(prefix)),
  );
  if (privateFiles.length > 0) {
    throw new Error(`npm pack output included private files: ${privateFiles.join(', ')}`);
  }
}

function assertPackageMetadata(packageRoot, expectedVersion) {
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  } catch (error) {
    throw new Error('Could not parse installed package.json', { cause: error });
  }

  if (packageJson.name !== 'llm-messages') {
    throw new Error(`Installed package name was ${JSON.stringify(packageJson.name)}`);
  }
  if (packageJson.license !== 'MIT') {
    throw new Error(`Installed package license was ${JSON.stringify(packageJson.license)}, expected "MIT"`);
  }
  if (
    packageJson.repository?.type !== 'git' ||
    packageJson.repository?.url !== 'git+https://github.com/slegarraga/llm-messages.git'
  ) {
    throw new Error('Installed package repository metadata did not match the public GitHub repository');
  }
  if (packageJson.homepage !== 'https://github.com/slegarraga/llm-messages#readme') {
    throw new Error(`Installed package homepage was ${JSON.stringify(packageJson.homepage)}`);
  }
  if (packageJson.bugs?.url !== 'https://github.com/slegarraga/llm-messages/issues') {
    throw new Error(`Installed package bugs URL was ${JSON.stringify(packageJson.bugs?.url)}`);
  }
  if (packageJson.version !== expectedVersion) {
    throw new Error(
      `Installed package version was ${JSON.stringify(packageJson.version)}, expected ${expectedVersion}`,
    );
  }
  if (packageJson.type !== 'module') {
    throw new Error(`Installed package type was ${JSON.stringify(packageJson.type)}, expected "module"`);
  }
  if (packageJson.main !== './dist/index.cjs') {
    throw new Error(`Installed package main was ${JSON.stringify(packageJson.main)}, expected "./dist/index.cjs"`);
  }
  if (packageJson.module !== './dist/index.js') {
    throw new Error(`Installed package module was ${JSON.stringify(packageJson.module)}, expected "./dist/index.js"`);
  }
  if (packageJson.types !== './dist/index.d.ts') {
    throw new Error(`Installed package types was ${JSON.stringify(packageJson.types)}, expected "./dist/index.d.ts"`);
  }
  if (packageJson.engines?.node !== '>=18') {
    throw new Error(`Installed package Node engine was ${JSON.stringify(packageJson.engines?.node)}, expected ">=18"`);
  }
  if (packageJson.sideEffects !== false) {
    throw new Error('Installed package must keep sideEffects=false for bundlers');
  }
  const missingKeywords = requiredPackageKeywords.filter((keyword) => !packageJson.keywords?.includes(keyword));
  if (missingKeywords.length > 0) {
    throw new Error(`Installed package keywords missing required values: ${missingKeywords.join(', ')}`);
  }
  if (
    packageJson.exports?.['.']?.types !== './dist/index.d.ts' ||
    packageJson.exports?.['.']?.import !== './dist/index.js' ||
    packageJson.exports?.['.']?.require !== './dist/index.cjs' ||
    packageJson.exports?.['./package.json'] !== './package.json'
  ) {
    throw new Error('Installed package exports did not match the expected ESM/CJS/type entrypoints');
  }

  const dependencyFields = [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ];
  const presentDependencyFields = dependencyFields.filter((field) => {
    const value = packageJson[field];
    if (value === undefined) return false;
    if (value === null) return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
  if (presentDependencyFields.length > 0) {
    throw new Error(`Installed package must keep zero runtime dependencies: ${presentDependencyFields.join(', ')}`);
  }
}

function assertPackageSourceMaps(packageRoot) {
  for (const file of sourceMapPackageFiles) {
    let sourceMap;
    try {
      sourceMap = JSON.parse(readFileSync(join(packageRoot, file), 'utf8'));
    } catch (error) {
      throw new Error(`Could not parse package source map ${file}`, { cause: error });
    }

    const sources = Array.isArray(sourceMap.sources) ? sourceMap.sources : [];
    if (sources.length === 0) {
      throw new Error(`Package source map ${file} did not include any sources`);
    }

    const invalidSources = sources.filter((source) => {
      if (typeof source !== 'string') {
        return true;
      }

      const normalized = source.replaceAll('\\', '/');
      return (
        !normalized.startsWith('../src/') ||
        !normalized.endsWith('.ts') ||
        /^([A-Za-z]:|\/|file:|\\\\)/.test(source) ||
        privateSourceMapMarkers.some((marker) => normalized.includes(marker))
      );
    });
    if (invalidSources.length > 0) {
      throw new Error(`Package source map ${file} included unexpected sources: ${invalidSources.join(', ')}`);
    }

    if (!Array.isArray(sourceMap.sourcesContent) || sourceMap.sourcesContent.length !== sources.length) {
      throw new Error(`Package source map ${file} sourcesContent does not match sources`);
    }

    const missingSourcesContent = sourceMap.sourcesContent
      .map((content, index) => ({ content, source: sources[index] }))
      .filter(({ content }) => typeof content !== 'string' || content.length === 0)
      .map(({ source }) => source);
    if (missingSourcesContent.length > 0) {
      throw new Error(
        `Package source map ${file} is missing embedded content for: ${missingSourcesContent.join(', ')}`,
      );
    }
  }
}

function packageMarkdownFiles(packageRoot, dir = packageRoot) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...packageMarkdownFiles(packageRoot, path));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(packageRoot, path).replaceAll('\\', '/'));
    }
  }
  return files;
}

function decodeLinkTarget(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function markdownAnchors(markdown) {
  const anchors = new Set();
  const seenHeadingSlugs = new Map();
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    for (const match of line.matchAll(/\sid=["']([^"']+)["']/g)) {
      anchors.add(match[1].toLowerCase());
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;

    const slugBase = heading[2]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .replace(/\s+/g, '-');
    const count = seenHeadingSlugs.get(slugBase) ?? 0;
    seenHeadingSlugs.set(slugBase, count + 1);
    anchors.add(count === 0 ? slugBase : `${slugBase}-${count}`);
  }

  return anchors;
}

function assertPackageMarkdownLinks(packageRoot) {
  const markdownLink = /!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
  const missingLinks = [];

  for (const file of packageMarkdownFiles(packageRoot)) {
    const text = readFileSync(join(packageRoot, file), 'utf8');
    for (const match of text.matchAll(markdownLink)) {
      const rawTarget = match[1]?.replace(/^<|>$/g, '');
      if (!rawTarget || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawTarget)) continue;

      const [rawPathPart = '', rawFragment = ''] = rawTarget.split('#', 2);
      const pathPart = decodeLinkTarget(rawPathPart);
      const fragment = decodeLinkTarget(rawFragment);

      const targetPath = pathPart ? resolve(packageRoot, dirname(file), pathPart) : join(packageRoot, file);
      const packageRelative = relative(packageRoot, targetPath).replaceAll('\\', '/');
      const escapesPackage = packageRelative.startsWith('../') || packageRelative === '..';
      const exists = !escapesPackage && statSync(targetPath, { throwIfNoEntry: false })?.isFile() === true;
      if (!exists) {
        missingLinks.push(`${file} -> ${rawTarget}`);
        continue;
      }

      if (fragment && packageRelative.toLowerCase().endsWith('.md')) {
        const anchors = markdownAnchors(readFileSync(targetPath, 'utf8'));
        if (!anchors.has(fragment.toLowerCase())) {
          missingLinks.push(`${file} -> ${rawTarget} (missing heading anchor)`);
        }
      }
    }
  }

  if (missingLinks.length > 0) {
    throw new Error(`Package markdown links point to missing files: ${missingLinks.join(', ')}`);
  }
}

function assertMarkdownLinkFailure(packageRoot, expectedSnippets) {
  try {
    assertPackageMarkdownLinks(packageRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingSnippets = expectedSnippets.filter((snippet) => !message.includes(snippet));
    if (missingSnippets.length === 0) {
      return;
    }
    throw new Error(`Markdown link checker failed with unexpected message: ${message}`, { cause: error });
  }

  throw new Error(`Markdown link checker unexpectedly accepted: ${expectedSnippets.join(', ')}`);
}

function assertMarkdownLinkCheckerSelfTest() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'llm-messages-markdown-links-'));

  try {
    mkdirSync(join(fixtureRoot, 'docs'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'README.md'),
      [
        '# Package Smoke',
        '',
        '[Same-file anchor](#package-smoke)',
        '[Cross-file heading](docs/guide.md#usage)',
        '[Duplicate heading](docs/guide.md#repeat-heading-1)',
        '[Explicit HTML id](docs/guide.md#custom-anchor)',
        '[Angle-bracket target](<docs/guide.md#usage>)',
        '![Remote image](https://example.com/badge.svg)',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(fixtureRoot, 'docs', 'guide.md'),
      [
        '# Usage',
        '',
        '## Repeat Heading',
        '## Repeat Heading',
        '<h2 id="custom-anchor">Custom</h2>',
        '',
        '```',
        '# Ignored Heading',
        '```',
        '',
      ].join('\n'),
    );

    assertPackageMarkdownLinks(fixtureRoot);

    writeFileSync(
      join(fixtureRoot, 'BROKEN.md'),
      [
        '# Broken Links',
        '',
        '[Missing file](docs/missing.md)',
        '[Missing same-file anchor](#missing-anchor)',
        '[Missing anchor](docs/guide.md#missing-section)',
        '[Escapes package](../outside.md)',
        '',
      ].join('\n'),
    );
    assertMarkdownLinkFailure(fixtureRoot, [
      'BROKEN.md -> docs/missing.md',
      'BROKEN.md -> #missing-anchor (missing heading anchor)',
      'BROKEN.md -> docs/guide.md#missing-section (missing heading anchor)',
      'BROKEN.md -> ../outside.md',
    ]);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

try {
  assertMarkdownLinkCheckerSelfTest();

  const packOutput = run(npmCommand, ['pack', '--pack-destination', tempRoot, '--foreground-scripts=false', '--json']);
  const [packEntry] = parsePackJson(packOutput);
  if (!packEntry?.filename) {
    throw new Error(`npm pack output did not include a tarball filename: ${packOutput}`);
  }
  assertPackageContents(packEntry);

  const tarballPath = join(tempRoot, packEntry.filename);
  const consumerRoot = join(tempRoot, 'consumer');
  mkdirSync(consumerRoot);
  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');

  run(
    npmCommand,
    ['install', '--silent', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarballPath],
    { cwd: consumerRoot, stdio: 'inherit' },
  );
  const installedPackageRoot = join(consumerRoot, 'node_modules', 'llm-messages');
  assertPackageMetadata(installedPackageRoot, packEntry.version);
  assertPackageSourceMaps(installedPackageRoot);
  assertPackageMarkdownLinks(installedPackageRoot);

  writeFileSync(
    join(consumerRoot, 'esm-smoke.mjs'),
    `import assert from 'node:assert/strict';
	import { normalizeResponse, toAnthropic, warningCodes } from 'llm-messages';
	
	const expectedWarningCodes = ${expectedWarningCodesJson};
	
	assert.equal(typeof normalizeResponse, 'function');
	assert.equal(typeof toAnthropic, 'function');
	assert.equal(Object.isFrozen(warningCodes), true);
	assert.deepEqual(warningCodes, expectedWarningCodes);
	
	const normalized = normalizeResponse(
  {
    choices: [
      {
        message: { role: 'assistant', content: 'ready' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  },
  { from: 'openai' },
);

assert.equal(normalized.message.content, 'ready');
assert.equal(normalized.finishReason, 'stop');
assert.deepEqual(normalized.usage, { inputTokens: 1, outputTokens: 2 });
assert.equal(toAnthropic([{ role: 'user', content: 'hello' }]).messages[0].role, 'user');
`,
  );

  writeFileSync(
    join(consumerRoot, 'cjs-smoke.cjs'),
    `const assert = require('node:assert/strict');
	const { normalizeResponse, warningCodes } = require('llm-messages');
	const packageJson = require('llm-messages/package.json');
	
	const expectedWarningCodes = ${expectedWarningCodesJson};
	
	assert.equal(typeof normalizeResponse, 'function');
	assert.equal(Object.isFrozen(warningCodes), true);
	assert.deepEqual(warningCodes, expectedWarningCodes);
	assert.equal(packageJson.name, 'llm-messages');
	assert.equal(packageJson.version, '${packEntry.version}');

const normalized = normalizeResponse(
  {
    choices: [
      {
        message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  },
  { from: 'openai' },
);

assert.equal(normalized.message.tool_calls[0].id, 'call_1');
assert.equal(normalized.finishReason, 'tool_calls');
assert.deepEqual(normalized.usage, { inputTokens: 3, outputTokens: 4 });
`,
  );

  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['types-smoke.ts', 'cjs-types-smoke.cts'],
      },
      null,
      2,
    ) + '\n',
  );

  writeFileSync(
    join(consumerRoot, 'types-smoke.ts'),
    `import {
  normalizeResponse,
  toAnthropic,
  warningCodes,
  type ConvertOptions,
  type NormalizedResponse,
  type OpenAIMessage,
  type Warning,
  type WarningCode,
} from 'llm-messages';

const messages: OpenAIMessage[] = [
  { role: 'system', content: 'Be concise.' },
  { role: 'user', content: [{ type: 'text', text: 'hello' }] },
];

const options: ConvertOptions = {
  onWarning(warning: Warning) {
    const code: WarningCode = warning.code;
    if (!warningCodes.includes(code)) {
      throw new Error(\`Unexpected warning code: \${code}\`);
    }
  },
};

const anthropic = toAnthropic(messages, options);
const normalized: NormalizedResponse = normalizeResponse(
  {
    choices: [
      {
        message: { role: 'assistant', content: 'ready' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  },
  { from: 'openai' },
);

if (anthropic.messages[0]?.role !== 'user' || normalized.message.content !== 'ready') {
  throw new Error('unexpected typed consumer result');
}
`,
  );

  writeFileSync(
    join(consumerRoot, 'cjs-types-smoke.cts'),
    `import llmMessages = require('llm-messages');

const code: llmMessages.WarningCode = 'generated-id';
const normalized: llmMessages.NormalizedResponse = llmMessages.normalizeResponse(
  {
    choices: [
      {
        message: { role: 'assistant', content: 'ready' },
        finish_reason: 'stop',
      },
    ],
  },
  { from: 'openai' },
);

if (!llmMessages.warningCodes.includes(code) || normalized.message.content !== 'ready') {
  throw new Error('unexpected typed CommonJS consumer result');
}
`,
  );

  execFileSync(process.execPath, ['esm-smoke.mjs'], { cwd: consumerRoot, stdio: 'inherit' });
  execFileSync(process.execPath, ['cjs-smoke.cjs'], { cwd: consumerRoot, stdio: 'inherit' });
  execFileSync(process.execPath, [tscBin, '--project', 'tsconfig.json'], { cwd: consumerRoot, stdio: 'inherit' });
  execFileSync(process.execPath, ['examples/usage.mjs'], {
    cwd: installedPackageRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  execFileSync(process.execPath, ['examples/commonjs.cjs'], {
    cwd: installedPackageRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  console.log(`Pack smoke passed: ${packEntry.name}@${packEntry.version} installed from ${packEntry.filename}.`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
