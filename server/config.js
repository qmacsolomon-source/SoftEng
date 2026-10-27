/**
 * Central configuration. Reads .env once and validates it so the server fails
 * loudly instead of behaving strangely at runtime.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

dotenv.config({ path: path.join(root, '.env') });

const read = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim();

const config = {
  root,
  port: Number.parseInt(read('PORT', '3000'), 10) || 3000,
  env: read('NODE_ENV', 'development'),
  isProduction: read('NODE_ENV', 'development') === 'production',

  supabase: {
    url: read('SUPABASE_URL'),
    anonKey: read('SUPABASE_ANON_KEY'),
    serviceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY'),
  },

  appSecret: read('APP_SECRET', 'insecure-development-secret'),

  allowedOrigins: read('ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  maxUploadBytes: (Number.parseInt(read('MAX_UPLOAD_MB', '5'), 10) || 5) * 1024 * 1024,
};

/** Which env values are missing/misconfigured. */
export function configProblems() {
  const problems = [];
  const { url, anonKey, serviceRoleKey } = config.supabase;

  if (!url || !/^https?:\/\//i.test(url)) problems.push('SUPABASE_URL is missing or not a valid URL.');
  if (!anonKey || anonKey.length < 20) problems.push('SUPABASE_ANON_KEY is missing.');
  if (!serviceRoleKey || serviceRoleKey.length < 20) problems.push('SUPABASE_SERVICE_ROLE_KEY is missing.');
  if (url.includes('your-project-ref')) problems.push('SUPABASE_URL still holds the placeholder value from .env.example.');

  return problems;
}

config.isConfigured = configProblems().length === 0;

export default config;
