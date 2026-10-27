/**
 * Supabase client factories.
 *
 *  supabaseAdmin  - service-role key, BYPASSES Row Level Security.
 *                   Used only for admin-only auth operations (create/delete
 *                   users). Never used to read or write business data.
 *
 *  supabaseAnon   - anon key, used for sign-in and token verification only.
 *
 *  userClient()   - anon key PLUS the signed-in user's access token, so every
 *                   query runs through Row Level Security as that user.
 *                   This is the client used for all business data.
 */
import { createClient } from '@supabase/supabase-js';
import config, { configProblems } from './config.js';

// Fail with a readable message instead of a stack trace from createClient when
// .env is missing or still holds placeholders.
const problems = configProblems();
if (problems.length) {
  console.error('\nCannot start: the Supabase configuration is incomplete.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nCopy .env.example to .env and fill in the values from your Supabase');
  console.error('project (Project Settings > API). See the README for the full setup steps.\n');
  process.exit(1);
}

const baseOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

export const supabaseAnon = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  baseOptions,
);

/**
 * A brand new anonymous client. Sign-in / refresh / password flows keep session
 * state inside the client instance, so each request gets its own throwaway
 * client rather than sharing one global instance.
 */
export function newAnonClient() {
  return createClient(config.supabase.url, config.supabase.anonKey, baseOptions);
}

export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  baseOptions,
);

/** Row-Level-Security-scoped client for one signed-in user. */
export function userClient(accessToken) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    ...baseOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
