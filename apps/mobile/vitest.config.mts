import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Render React Native components with react-native-web in jsdom (smoke tests).
    alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
