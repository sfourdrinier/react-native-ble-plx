const { FlatCompat } = require('@eslint/eslintrc')
const js = require('@eslint/js')
const globals = require('globals')

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
})

module.exports = [
  {
    ignores: ['**/node_modules/**', 'docs/**', 'plugin/build/**', 'lib/**']
  },
  ...compat.extends('@react-native', 'prettier'),
  ...compat
    .config({
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react-hooks/recommended',
        'plugin:react/recommended',
        'prettier'
      ],
      parser: '@typescript-eslint/parser',
      plugins: ['react-refresh', '@typescript-eslint', 'import', 'prettier'],
      env: {
        es2020: true
      }
    })
    .map((config) => ({
      ...config,
      files: ['**/*.tsx', '**/*.ts', '**/*.d.ts']
    })),
  {
    files: ['**/*.tsx', '**/*.ts', '**/*.d.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: {
        ...globals.es2020
      }
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      'import/prefer-default-export': 'off',
      'import/no-default-export': 2,
      'prettier/prettier': 'warn',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',
      'no-promise-executor-return': 'off',
      'no-bitwise': 'off',
      'no-param-reassign': 'off',
      'react/require-default-props': 'off',
      'no-continue': 'off',
      'no-constant-condition': 'off',
      'no-await-in-loop': 'off',
      'react-native/no-inline-styles': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      'react/jsx-props-no-spreading': 'off',
      'class-methods-use-this': 'off',
      'eslint-comments/no-unused-disable': 'off',
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      'max-classes-per-file': 'off',
      'prettier/prettier': 'off'
    }
  },
  {
    files: ['src/Native*.ts'],
    rules: {
      'import/no-default-export': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off'
    }
  },
  {
    files: ['plugin/**'],
    rules: {
      'no-underscore-dangle': 0,
      'no-console': 'warn',
      '@typescript-eslint/naming-convention': 0,
      'import/no-default-export': 0,
      '@typescript-eslint/no-shadow': 0,
      'global-require': 0,
      '@typescript-eslint/no-var-requires': 0,
      'import/no-extraneous-dependencies': 'off'
    }
  },
  {
    files: ['plugin/src/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
]
