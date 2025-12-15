const js = require('@eslint/js')
const globals = require('globals')
const tseslint = require('typescript-eslint')
const reactRefresh = require('eslint-plugin-react-refresh')

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: globals.browser
    },
    plugins: {
      'react-refresh': reactRefresh
    },
    rules: {
      'react-refresh/only-export-components': 'warn'
    }
  }
]
