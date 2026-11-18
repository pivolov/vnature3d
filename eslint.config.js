import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**'] },
  { ...eslint.configs.recommended, files: ['src/**/*.{ts,tsx}'] },
  ...tseslint.configs.recommended,
];
