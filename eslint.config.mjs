import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: ['out/**', '.next/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // Service Worker e bridge rodam no browser, mas nao passam pelo parser do Next.
    files: ['public/sw.js', 'public/preview-bridge.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        self: 'readonly',
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        parent: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Promise: 'readonly',
        Object: 'readonly',
        Array: 'readonly',
        Number: 'readonly',
        Boolean: 'readonly',
        String: 'readonly',
        Error: 'readonly',
      },
    },
    rules: {
      // Esses arquivos sao scripts classicos de browser: var e try/catch vazio
      // sao idiomaticos aqui, e o codigo roda em sandbox sem bundler.
      'no-var': 'off',
      'prefer-const': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
);