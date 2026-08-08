import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Token discipline for the app.
//
// The alert-map panel had drifted onto a private palette of hex literals
// that existed nowhere in packages/ui/src/styles/globals.css, which is why it
// read as a different application. Nothing prevented that, so this does.
//
// Every module in src has now been migrated to design tokens — the rule is an
// ERROR across all of src, so any future hex literal in a className fails the
// build until either a token is used or a new token is added to globals.css.
const HEX_IN_CLASSNAME = [
  {
    // Matches hex colours inside className strings, e.g. "text-[#2447b3]".
    selector: 'JSXAttribute[name.name="className"] Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
    message:
      'Use a design token instead of a hex colour (see packages/ui/src/styles/globals.css). If the colour you need does not exist, add a token for it.',
  },
  {
    selector:
      'JSXAttribute[name.name="className"] TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
    message:
      'Use a design token instead of a hex colour (see packages/ui/src/styles/globals.css). If the colour you need does not exist, add a token for it.',
  },
]

const MIGRATED = ['src/**/*.{ts,tsx}']

export default defineConfig([

  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // The codebase already writes intentionally-unused bindings with a
      // leading underscore (`_single` in a rest-omit, `_side` on a signature
      // kept for API compatibility, `(_: string) => {}` context defaults).
      // The convention was in the code but not in the config, so each one was
      // reported as an error — which is how real unused-variable findings end
      // up buried in noise.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: MIGRATED,
    rules: { 'no-restricted-syntax': ['error', ...HEX_IN_CLASSNAME] },
  },
])
