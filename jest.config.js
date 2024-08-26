/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  testEnvironment: "node",
  preset: 'ts-jest',
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/bankrun_test/'],
  transform: {
    '^.+\\.(ts|tsx)?$': ["ts-jest",{
      tsconfig: 'tsconfig.test.json',
      diagnostics: {
        exclude: ['tests/bankrun_test/**'],
      }
    }],
  },
};