// @jakobmelchard/config ships its ESLint base as untyped JS.
declare module '@jakobmelchard/config/eslint' {
  const config: import('eslint').Linter.Config[]
  export default config
}
