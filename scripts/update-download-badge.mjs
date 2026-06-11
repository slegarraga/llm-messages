import https from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const pkg = JSON.parse(await readFile('package.json', 'utf8')).name;
const outDir = path.join('badges', 'npm-downloads');
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultWindow() {
  const now = process.env.DOWNLOAD_BADGE_TODAY
    ? new Date(`${process.env.DOWNLOAD_BADGE_TODAY}T00:00:00.000Z`)
    : new Date();

  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid DOWNLOAD_BADGE_TODAY: ${process.env.DOWNLOAD_BADGE_TODAY}`);
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);

  return {
    start: process.env.DOWNLOAD_BADGE_START || isoDate(start),
    end: process.env.DOWNLOAD_BADGE_END || isoDate(end),
  };
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'npm-package-download-badge-refresh',
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
            reject(new Error(`Request failed: ${response.statusCode} ${response.statusMessage}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy(new Error('Request timed out'));
    });
  });
}

function formatDownloads(downloads) {
  if (downloads >= 1_000_000) {
    return `${(downloads / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  }

  if (downloads >= 1_000) {
    return `${(downloads / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }

  return String(downloads);
}

function colorFor(downloads) {
  if (downloads === 0) return 'red';
  if (downloads < 100) return 'yellowgreen';
  if (downloads < 1_000) return 'green';
  return 'brightgreen';
}

async function fetchDownloads(start, end) {
  const url = `https://api.npmjs.org/downloads/range/${start}:${end}/${encodeURIComponent(pkg)}`;
  const body = await getJson(url);
  const rows = Array.isArray(body.downloads) ? body.downloads : [];
  const downloads = rows.reduce((sum, row) => sum + Number(row.downloads || 0), 0);

  return { downloads, start: body.start || start, end: body.end || end };
}

function badgeJson(result) {
  return {
    schemaVersion: 1,
    label: 'downloads',
    message: `${formatDownloads(result.downloads)}/30d`,
    color: colorFor(result.downloads),
    cacheSeconds: 3600,
    namedLogo: 'npm',
  };
}

async function readExisting(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function main() {
  const { start, end } = defaultWindow();
  const result = await fetchDownloads(start, end);
  const file = path.join(outDir, `${pkg}.json`);
  const next = `${JSON.stringify(badgeJson(result), null, 2)}\n`;
  const current = await readExisting(file);

  if (checkOnly && current !== next) {
    throw new Error(`${file} is stale. Run node scripts/update-download-badge.mjs`);
  }

  if (!checkOnly) {
    await mkdir(outDir, { recursive: true });
    await writeFile(file, next);
  }

  console.log(`${pkg}: ${result.downloads} downloads (${result.start}..${result.end})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
