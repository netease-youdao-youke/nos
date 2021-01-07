module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
    'eslint-plugin-tsdoc'
  ],
  extends: [
    'airbnb-typescript',
  ],
  rules: {
    'tsdoc/syntax': 'warn'
  }
};