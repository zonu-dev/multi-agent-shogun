import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 3200;
export const SERVER_HOST = '127.0.0.1';
export const VITE_DEV_HOST = 'localhost';
export const VITE_DEV_PORT = 3210;
export const SHOGUN_TARGET_PANE = 'shogun:0.0';
export const ALLOWED_HTTP_ORIGIN = 'http://localhost:3210';
export const API_AUTH_HEADER = 'x-shogun-token';
const rawApiAuthToken = process.env.SHOGUN_API_TOKEN?.trim();
export const API_AUTH_TOKEN =
  rawApiAuthToken && rawApiAuthToken.length > 0 ? rawApiAuthToken : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const BASE_DIR = path.resolve(__dirname, '../../..');
export const TASKS_DIR = path.join(BASE_DIR, 'queue', 'tasks');
export const REPORTS_DIR = path.join(BASE_DIR, 'queue', 'reports');
export const COMMAND_FILE_PATH = path.join(BASE_DIR, 'queue', 'shogun_to_karo.yaml');
export const COMMAND_ARCHIVE_FILE_PATH = path.join(
  BASE_DIR,
  'queue',
  'archive',
  'shogun_to_karo_archive.yaml'
);
export const DASHBOARD_FILE_PATH = path.join(BASE_DIR, 'dashboard.md');
export const GAME_STATE_FILE_PATH = path.join(BASE_DIR, 'web', 'game-state.yaml');
