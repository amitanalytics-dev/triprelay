import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const day = process.argv[2] ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error('Use npm run metrics -- YYYY-MM-DD, or omit the date for today in India.');
  process.exit(1);
}
const project = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/convex/bin/main.js', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'run', 'metrics:dailySummary', JSON.stringify({day})], {
  cwd: project, stdio: 'inherit', shell: false,
});
if (result.error) { console.error('Could not open the installed Convex command.'); process.exit(1); }
process.exit(result.status ?? 1);
