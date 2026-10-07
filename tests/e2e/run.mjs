// Runs every end-to-end check against the running dev servers:
//   npm run dev            (CMS, http://localhost:3001 by default: E2E_CMS_URL)
//   Qub-X dev server       (optional, http://localhost:3000: E2E_QUBX_URL)
//   npm run test:e2e
// Sign-in: E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (defaults: the local demo admin).
import { failed } from "./lib.mjs";

for (const suite of ["permissions", "activity", "planning", "overview", "category-ai", "image-rights", "media", "publishing", "i18n", "time-zone"]) {
  console.log(`\n# ${suite}`);
  await import(`./${suite}.mjs`);
}
console.log(failed() ? `\n${failed()} check(s) FAILED` : "\nAll checks passed");
process.exit(failed() ? 1 : 0);
