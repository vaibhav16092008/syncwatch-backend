import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// If process was executed via node --test or npm test, enforce NODE_ENV = 'test'
if (
  process.env.NODE_ENV === 'test' ||
  process.env.SYNCWATCH_TEST_MODE === 'true' ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => typeof arg === 'string' && (arg.includes('--test') || arg.includes('test')))
) {
  process.env.NODE_ENV = 'test';
}

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100)
});

const envToValidate = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development'
};

const parsed = envSchema.safeParse(envToValidate);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const config = Object.freeze(parsed.data);
export default config;
