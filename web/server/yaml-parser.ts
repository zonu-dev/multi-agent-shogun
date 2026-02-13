import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface YamlParseResult<T = unknown> {
  data: T | null;
  error: string | null;
}

export interface YamlReadResult<T = unknown> extends YamlParseResult<T> {
  raw: string;
}

export function parseYaml<T = unknown>(raw: string): YamlParseResult<T> {
  if (raw.trim() === '') {
    return { data: null, error: null };
  }

  try {
    const parsed = yaml.load(raw) as T;
    return { data: parsed, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Failed to parse YAML',
    };
  }
}

export function stringifyYaml(value: unknown): string {
  try {
    return `${yaml.dump(value, { noRefs: true, lineWidth: 120 }).trimEnd()}\n`;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to stringify YAML');
  }
}

export async function readYamlFile<T = unknown>(filePath: string): Promise<YamlReadResult<T>> {
  let raw = '';

  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { data: null, raw: '', error: null };
    }

    return {
      data: null,
      raw: '',
      error: error instanceof Error ? error.message : 'Failed to read YAML file',
    };
  }

  const parsed = parseYaml<T>(raw);
  return {
    data: parsed.data,
    raw,
    error: parsed.error,
  };
}

export async function writeYamlFile(filePath: string, value: unknown): Promise<void> {
  const serialized = stringifyYaml(value);
  const directoryPath = path.dirname(filePath);
  const tempFilePath = `${filePath}.tmp`;

  await fs.mkdir(directoryPath, { recursive: true });

  let tempFileHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    tempFileHandle = await fs.open(tempFilePath, 'w');
    await tempFileHandle.writeFile(serialized, 'utf8');
    await tempFileHandle.sync();
    await tempFileHandle.close();
    tempFileHandle = null;

    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    if (tempFileHandle !== null) {
      await tempFileHandle.close().catch(() => undefined);
    }
    await fs.unlink(tempFilePath).catch(() => undefined);
    throw error;
  }
}
