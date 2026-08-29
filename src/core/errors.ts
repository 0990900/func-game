import { Data } from 'effect';

/**
 * A rule violation. `message` is user-facing Korean text, surfaced to the
 * client verbatim — the same strings the legacy core threw as plain Errors.
 */
export class RuleError extends Data.TaggedError('RuleError')<{
  readonly message: string;
}> {}

export const ruleError = (message: string): RuleError => new RuleError({ message });
