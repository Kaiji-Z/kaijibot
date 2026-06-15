import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";

/**
 * Validation error shape produced by TypeBox's Compile().Errors().
 *
 * TypeBox's `TLocalizedValidationError` has the same structural fields but
 * narrows `params` to a discriminated union per keyword.  We use a loose
 * `Record<string, unknown>` here so consumers can access keyword-specific
 * params (`additionalProperties`, `requiredProperties`, …) via narrow casts
 * without importing the full discriminated union.
 */
export type TypeBoxValidationError = {
  keyword: string;
  instancePath: string;
  params: Record<string, unknown>;
  message?: string;
};

/**
 * A validator function compatible with the legacy `Validator<T>` usage:
 *
 * ```ts
 * if (validate(data)) { ... } else { formatValidationErrors(validate.errors) }
 * ```
 *
 * `errors` is `null` after a successful (or fresh) check, and populated with
 * a {@link TypeBoxValidationError} array after a failing check.
 */
export type TypeBoxValidator<T> = ((data: unknown) => data is T) & {
  errors: TypeBoxValidationError[] | null;
};

/**
 * Compile a TypeBox {@link TSchema} into a {@link TypeBoxValidator} that
 * matches the existing `(data) => boolean` + `.errors` call-site pattern.
 *
 * This is a thin adapter over `typebox/compile`'s `Compile()`:
 * - `validator.Check(data)`  → fast boolean
 * - `validator.Errors(data)` → detailed error list (only fetched on failure)
 */
export function compileTypeBoxValidator<T>(schema: TSchema): TypeBoxValidator<T> {
  const validator = Compile(schema);

  function validate(data: unknown): data is T {
    const self = validate as TypeBoxValidator<T>;
    if (validator.Check(data)) {
      self.errors = null;
      return true;
    }
    self.errors = validator.Errors(data) as unknown as TypeBoxValidationError[];
    return false;
  }

  (validate as TypeBoxValidator<T>).errors = null;
  return validate as TypeBoxValidator<T>;
}
