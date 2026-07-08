import { defineConfig } from 'cypress';

export default defineConfig({
  projectId: 'vwwffz',
  e2e: {
    // Client dev server URL. Defaults to the normal dev port; override for other
    // setups (e.g. a dedicated self-hosted test instance) with CYPRESS_BASE_URL.
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:4050',
    setupNodeEvents(on, config) {
      // Self-hosted API base URL used by the M5.5 onboarding E2E. Override with
      // CYPRESS_API_URL. The test requires the API started with SELF_HOSTED=true
      // and the client built with VITE_SELF_HOSTED=true.
      config.env.apiUrl = process.env.CYPRESS_API_URL || config.env.apiUrl || 'http://localhost:8000';
      return config;
    },
  },
});
