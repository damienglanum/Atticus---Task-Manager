import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  {
    ignores: ["dist", "src-tauri/target", "src-tauri/gen", "src/lib/bindings", "coverage"],
  },
  js.configs.recommended,

  // Type-aware linting applies to the application source only. Config files live
  // outside every tsconfig, so type-checked rules would crash on them.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // The coding standards forbid `any` and forbid silently swallowing failures.
      // These are errors, not warnings: a warning nobody fixes is a lie.
      "@typescript-eslint/no-explicit-any": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // `invoke()` is the security boundary. It belongs in exactly one module.
      // Node builtins have no business in a webview bundle; `node` types are
      // enabled only so tests can read files.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/core",
              importNames: ["invoke"],
              message:
                "Call Tauri commands through src/lib/ipc.ts so the command surface stays in one greppable place (ADR-0010).",
            },
          ],
          patterns: [
            {
              group: ["node:*", "fs", "path", "os", "child_process"],
              message:
                "Node builtins are not available in the webview. If you need the filesystem, add a Tauri command.",
            },
          ],
        },
      ],
    },
  },

  // ipc.ts is the one module allowed to reach for invoke().
  {
    files: ["src/lib/ipc.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  {
    files: ["**/*.test.{ts,tsx}", "vitest.setup.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
      // Tests run in Node and may legitimately read files from disk.
      "no-restricted-imports": "off",
    },
  },

  // Node-side tooling: plain JS, no type information available.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Build configuration runs in Node, not in the webview.
  {
    files: ["vite.config.ts"],
    languageOptions: { globals: globals.node },
    rules: { "no-restricted-imports": "off" },
  },

  // End-to-end specs run in the WebdriverIO runner under Node, and drive the
  // application from outside. `browser`, `$` and the Mocha globals are injected
  // by the runner rather than imported.
  {
    files: ["e2e/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.mocha,
        browser: "readonly",
        $: "readonly",
        $$: "readonly",
        expect: "readonly",
      },
    },
    rules: {
      "no-restricted-imports": "off",
      // WebdriverIO's `$` returns a thenable element reference that is awaited
      // by the commands called on it, so the usual promise hygiene rules fire
      // constantly on correct code.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
);
