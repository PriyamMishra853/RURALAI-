import { withGroq, poolSize, poolStatus } from './keyPool.js';

/**
 * Groq access, pooled.
 *
 * `groq` is kept as a truthy guard so the existing `if (!groq)` checks that
 * decide whether to degrade still read the same way — but it is no longer a
 * single client bound to one key. Every actual call goes through `withGroq`,
 * which round-robins the pool and benches a key that hits its rate limit.
 */

export const groqAvailable = () => poolSize() > 0;

/** Back-compat guard: truthy when at least one key is configured. */
export const groq = poolSize() > 0 ? { pooled: true } : null;

/**
 * Run one chat completion against the pool.
 * Signature matches `groq.chat.completions.create(params)` so call sites read
 * the same as before.
 */
export const groqChat = (params) => withGroq((client) => client.chat.completions.create(params));

/** Run one audio transcription against the pool. */
export const groqTranscribe = (params) => withGroq((client) => client.audio.transcriptions.create(params));

export { poolStatus, poolSize };
