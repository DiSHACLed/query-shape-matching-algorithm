import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/class-methods-use-this": "error",
      "@typescript-eslint/explicit-member-accessibility": "error",
      "@typescript-eslint/method-signature-style": "error",
      "@typescript-eslint/no-loop-func": "error",
      "@typescript-eslint/no-unused-vars": "error",
      //"@typescript-eslint/strict-boolean-expressions": "error"
    }
  },
  {
    ignores: [
      "**/*.js",
      "**/*.mjs",
      "**/*.d.ts",
      "node_modules/*",
      ".yarn/*"
    ]
  }
);