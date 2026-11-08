// Stands in for 'eslint/universal' in the Try it sandbox bundle (scripts/build.mjs): the simulator only needs
// lint's load-blocking rules, which are ours, so ESLint's general rules aren't bundled into the sandbox.
export class Linter {
  verify(): never[] {
    return [];
  }
}
