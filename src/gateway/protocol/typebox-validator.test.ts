import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { SessionsListParamsSchema, SessionsSendParamsSchema } from "./schema/sessions.js";
import {
  compileTypeBoxValidator,
  type TypeBoxValidationError,
  type TypeBoxValidator,
} from "./typebox-validator.js";

describe("compileTypeBoxValidator", () => {
  describe("with SessionsListParamsSchema (all-optional fields, additionalProperties: false)", () => {
    const validate = compileTypeBoxValidator<Record<string, unknown>>(SessionsListParamsSchema);

    it("accepts a valid empty object and leaves errors null", () => {
      expect(validate({})).toBe(true);
      expect(validate.errors).toBe(null);
    });

    it("accepts valid input with known optional fields and leaves errors null", () => {
      expect(validate({ limit: 10, activeMinutes: 5 })).toBe(true);
      expect(validate.errors).toBe(null);
    });

    it("rejects an unknown additional property and populates errors", () => {
      const result = validate({ unexpectedField: "x" });
      expect(result).toBe(false);
      expect(validate.errors).not.toBeNull();
      expect(validate.errors!.length).toBeGreaterThan(0);
      const ap = validate.errors!.find((e) => e.keyword === "additionalProperties");
      expect(ap).toBeDefined();
    });

    it("rejects a wrong-typed field and populates errors", () => {
      const result = validate({ limit: "not-a-number" });
      expect(result).toBe(false);
      expect(validate.errors).not.toBeNull();
      expect(validate.errors!.length).toBeGreaterThan(0);
    });

    it("resets errors back to null after a subsequent successful check", () => {
      validate({ unexpectedField: "x" });
      expect(validate.errors).not.toBeNull();
      expect(validate({})).toBe(true);
      expect(validate.errors).toBe(null);
    });
  });

  describe("with SessionsSendParamsSchema (has required fields key + message)", () => {
    const validate = compileTypeBoxValidator<Record<string, unknown>>(SessionsSendParamsSchema);

    it("rejects missing required fields and populates errors", () => {
      const result = validate({});
      expect(result).toBe(false);
      expect(validate.errors).not.toBeNull();
      expect(validate.errors!.length).toBeGreaterThan(0);
      const required = validate.errors!.find((e) => e.keyword === "required");
      expect(required).toBeDefined();
    });

    it("accepts valid input with all required fields", () => {
      expect(validate({ key: "session-key", message: "hello" })).toBe(true);
      expect(validate.errors).toBe(null);
    });
  });

  describe("with a custom schema exercising nested additionalProperties", () => {
    const nested = Type.Object(
      { auth: Type.Object({ token: Type.String() }, { additionalProperties: false }) },
      { additionalProperties: false },
    );
    const validate = compileTypeBoxValidator<unknown>(nested);

    it("reports the instancePath for nested unexpected property", () => {
      const result = validate({ auth: { token: "t", extra: "x" } });
      expect(result).toBe(false);
      const ap = validate.errors!.find((e) => e.keyword === "additionalProperties");
      expect(ap).toBeDefined();
      // Nested errors should point at the auth sub-path.
      expect(ap!.instancePath).toBe("/auth");
    });
  });

  describe("function shape", () => {
    it("returns a callable function with an errors property", () => {
      const validate = compileTypeBoxValidator<unknown>(SessionsListParamsSchema);
      expect(typeof validate).toBe("function");
      expect(validate).toHaveProperty("errors");
    });

    it("initializes errors to null", () => {
      const validate = compileTypeBoxValidator<unknown>(SessionsListParamsSchema);
      expect(validate.errors).toBe(null);
    });

    it("produced errors conform to TypeBoxValidationError shape", () => {
      const validate = compileTypeBoxValidator<unknown>(SessionsListParamsSchema);
      validate({ unexpectedField: "x" });
      const error = validate.errors![0] as TypeBoxValidationError;
      expect(typeof error.keyword).toBe("string");
      expect(typeof error.instancePath).toBe("string");
      expect(typeof error.params).toBe("object");
    });

    it("satisfies the TypeBoxValidator<T> type contract", () => {
      const validate: TypeBoxValidator<unknown> =
        compileTypeBoxValidator<unknown>(SessionsListParamsSchema);
      // Type-level: errors is TypeBoxValidationError[] | null
      const _typeCheck: TypeBoxValidationError[] | null = validate.errors;
      expect(_typeCheck).toBe(null);
    });
  });
});
