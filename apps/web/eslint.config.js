// ESLint v9 flat config for @vac-web/web. Replaces the legacy .eslintrc path
// after the v9 migration; v9 stopped looking up .eslintrc by default.
//
// Goals:
// - Lint TypeScript + TSX under src/ with the @typescript-eslint plugin that
//   is already declared in package.json devDependencies (no new prod deps).
// - Allow vite.config.ts to opt in via its own files entry without forcing a
//   tsconfig project graph (lint stays fast and offline).
// - Treat unused identifiers as errors but tolerate the `_` prefix that the
//   codebase uses for intentional placeholders (see e2e.ts, pickSealer args).

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser surface used across apps/web.
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        history: 'readonly',
        location: 'readonly',
        WebSocket: 'readonly',
        Worker: 'readonly',
        MessageChannel: 'readonly',
        MessagePort: 'readonly',
        BroadcastChannel: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        requestIdleCallback: 'readonly',
        cancelIdleCallback: 'readonly',
        performance: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        EventTarget: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        Image: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        DocumentFragment: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        // Build-tool / process surface (vite.config.ts).
        process: 'readonly',
        globalThis: 'readonly',
        // Test surface (vitest provides these but we exclude tests above —
        // declared anyway so an accidental include doesn't false-positive).
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      // React hook rules — catch dependency-array bugs early. Pulled from
      // eslint-plugin-react-hooks recommended preset (rules-of-hooks: error,
      // exhaustive-deps: warn) without importing the preset object directly
      // so this config stays compatible with both v4 (legacy) and v5 (flat).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Core ESLint rules we still want regardless of TS.
      'no-undef': 'off', // TS already handles this; ESLint flat config without parser-level globals trips on TS-only types.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'warn',

      // TypeScript-aware unused detection. The codebase intentionally prefixes
      // unused params with `_`; honor that.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
    },
  },
];
