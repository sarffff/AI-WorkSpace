/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.spec.ts'],
  // 不扫描编译产物与依赖目录
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // tsconfig 的 "@/*" → "./src/*" 路径别名
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}
