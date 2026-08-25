/**
 * Differential corpus for the ADR-201 sandboxed evaluator (#180).
 *
 * EVAL_CASES is the behavioural-parity contract: these expectations were
 * locked in PR1 against the old `new Function` path and must keep passing
 * unchanged now that expression-eval backs the evaluator — that equivalence
 * IS the migration's safety proof.
 *
 * The SECURITY block is the inverted half: the sandbox-escape expressions
 * that executed arbitrary JS under `new Function` must now all fail closed —
 * never a function, never the real global, never a computed value.
 */

import { App } from 'obsidian';
import { ExpressionEvaluator } from '../src/utils/expression-evaluator';
import { FormulaEngine } from '../src/utils/formula-engine';
import {
  EVAL_CASES,
  SECURITY_EXPRESSIONS,
  makeNoteContext,
} from './fixtures/base-corpus';

const evaluator = new ExpressionEvaluator(new App());

describe('ExpressionEvaluator — behavioural baseline (current new Function, ADR-201/#180)', () => {
  for (const { expr, expected } of EVAL_CASES) {
    it(`evaluates: ${expr}`, () => {
      expect(evaluator.evaluate(expr, makeNoteContext())).toEqual(expected);
    });
  }
});

describe('ExpressionEvaluator — sandbox escapes fail closed (ADR-201)', () => {  // The exact expressions that returned 2/42/99 under `new Function` must now
  // yield the evaluator's safe `false` (denylist throws → existing catch).
  const formerlyExecuting = [
    'constructor.constructor("return 1 + 1")()',
    '({}).constructor.constructor("return 42")()',
    '(1).constructor.constructor("return 99")()',
  ];

  for (const expr of formerlyExecuting) {
    it(`no longer executes: ${expr}`, () => {
      expect(evaluator.evaluate(expr, makeNoteContext())).toBe(false);
    });
  }

  it('no SECURITY_EXPRESSIONS entry reaches a function, the real global, or a value', () => {
    for (const expr of SECURITY_EXPRESSIONS) {
      const result = evaluator.evaluate(expr, makeNoteContext());
      // The security property: never a callable, never the real globalThis,
      // and never a "successful" computed value — only the safe failure
      // sentinels (false from the catch, or an unresolved-identifier undefined
      // that carries no global reach).
      expect(typeof result).not.toBe('function');
      expect(result).not.toBe(globalThis);
      expect(result === false || result === undefined || result === null).toBe(
        true,
      );
    }
  });
});

describe('FormulaEngine — failures surface as null, not false', () => {
  // Live-probed 2026-08-24 on the deployed build: a formula calling an
  // unknown function vanished from the results entirely. The strict
  // pipeline keeps the key present with null, so a computed false and an
  // error stay distinguishable.
  it('an unknown function evaluates to null through the formula engine', async () => {
    const engine = new FormulaEngine(new App());
    await expect(engine.evaluate('nonexistent(1)', makeNoteContext())).resolves.toBeNull();
  });

  it('the removed legacy spellings now fail like any unknown function', async () => {
    const engine = new FormulaEngine(new App());
    await expect(engine.evaluate('iff(true, 1, 2)', makeNoteContext())).resolves.toBeNull();
    await expect(engine.evaluate('choice(true, 1, 2)', makeNoteContext())).resolves.toBeNull();
  });

  it('a valid native if() evaluates through the formula engine', async () => {
    const engine = new FormulaEngine(new App());
    await expect(engine.evaluate('if(priority > 2, "big", "small")', makeNoteContext())).resolves.toBe('big');
  });

  it('a computed false stays false through the formula engine', async () => {
    const engine = new FormulaEngine(new App());
    await expect(engine.evaluate('if(done, true, false)', makeNoteContext())).resolves.toBe(false);
  });
});
