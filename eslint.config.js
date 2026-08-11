import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

const scopedFiles = ['src/**/*.{js,jsx}', 'electron/**/*.{js,cjs}', 'scripts/**/*.{js,cjs}']

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'tests/**',
      'playwright-report/**',
      'test-results/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.cjs',
      'vite.config*.js',
      'src/assets/pixel-agents-webview/**',
    ],
  },
  {
    files: scopedFiles,
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      // Codebase convention: a leading underscore marks a binding as
      // intentionally unused (already used in e.g. pixelAgents.cjs's
      // `_getMainWindow`, copilotAdapter.cjs's `_opts`) — recognize it
      // instead of flagging every catch(_) {} and unused _-prefixed param.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-useless-assignment': 'error',
      'preserve-caught-error': 'error',
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Electron's custom <webview> element supports a real `preload` attribute
      // that eslint-plugin-react's DOM property list doesn't know about.
      'react/no-unknown-property': ['error', { ignore: ['preload'] }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['electron/**/*.{js,cjs}', 'scripts/**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      // webview-preload.cjs runs in an Electron webview's browser context
      // despite its .cjs extension, so it needs browser globals too.
      globals: { ...globals.node, ...globals.browser, ...globals.vitest },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Test files under electron/ use ESM import/export despite their .cjs/.js
    // extension — Vitest transforms them regardless, but raw ESLint parsing
    // needs sourceType: 'module' here to match.
    files: ['electron/**/*.test.{js,cjs}'],
    languageOptions: {
      sourceType: 'module',
    },
  },
]
