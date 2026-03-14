import fs from 'fs';
import path from 'path';

export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function computeLineCol(text: string, pos: number): { line: number; col: number; lineText: string } {
  const boundedPos = Number.isFinite(pos) ? Math.max(0, Math.min(text.length, Math.floor(pos))) : 0;

  let line = 1;
  let col = 1;
  let lineStart = 0;

  for (let index = 0; index < boundedPos; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      col = 1;
      lineStart = index + 1;
    } else {
      col += 1;
    }
  }

  let lineEnd = text.indexOf('\n', lineStart);
  if (lineEnd < 0) lineEnd = text.length;

  let lineText = text.slice(lineStart, lineEnd);
  if (lineText.endsWith('\r')) {
    lineText = lineText.slice(0, -1);
  }

  return { line, col, lineText };
}

function extractPosition(errorMessage: string): number {
  const match = /position\s+(\d+)/i.exec(errorMessage);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validateFixtures(tasksDir: string): number {
  const entries = fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort(compareStrings);

  const invalids: Array<{ relativePath: string; line: number; col: number; lineText: string }> = [];

  for (const fileName of entries) {
    const absolutePath = path.join(tasksDir, fileName);
    const relativePath = `bench/tasks/${fileName}`;
    let text = '';

    try {
      text = fs.readFileSync(absolutePath, 'utf8');
      JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const position = extractPosition(message);
      const computed = computeLineCol(text, position);
      const line = Number.isInteger(computed.line) && computed.line > 0 ? computed.line : 1;
      const col = Number.isInteger(computed.col) && computed.col > 0 ? computed.col : 1;
      const lineText = typeof computed.lineText === 'string' ? computed.lineText : '';

      invalids.push({
        relativePath,
        line,
        col,
        lineText,
      });
    }
  }

  if (invalids.length === 0) {
    process.stdout.write('ALL_FIXTURES_VALID\n');
    return 0;
  }

  for (const invalid of invalids) {
    process.stdout.write(`INVALID_JSON ${invalid.relativePath} line=${invalid.line} col=${invalid.col}\n`);
    process.stdout.write('CONTEXT_BEGIN\n');
    process.stdout.write(`${invalid.lineText.trimEnd()}\n`);
    process.stdout.write(`${' '.repeat(Math.max(0, invalid.col - 1))}^\n`);
    process.stdout.write('CONTEXT_END\n');
  }

  return 1;
}

function main(): void {
  const tasksDir = path.resolve(process.cwd(), 'bench', 'tasks');
  const exitCode = validateFixtures(tasksDir);
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}
