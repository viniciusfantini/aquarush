// Publica a POC Babylon no GitHub Pages (branch gh-pages do repositório "origin").
// Uso: npm run deploy   →   https://<usuário>.github.io/<repo>/
// Passos: typecheck + testes de física + build → copia dist/ para um repositório temporário →
// commit → push --force para gh-pages. Não mexe no seu working tree nem na branch main.

import { execSync } from "node:child_process";
import { mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd, cwd) => {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
};

const root = process.cwd();
run("npx tsc --noEmit", root);
run("node tests/sim.test.ts", root); // falha = não publica
run("npx vite build", root);

const origin = run("git remote get-url origin", root);
const sha = run("git rev-parse --short HEAD", root);
const version = JSON.parse(execSync("npm pkg get version", { cwd: root }).toString());
const tmp = mkdtempSync(join(tmpdir(), "aquarush-pages-"));
try {
  cpSync(join(root, "dist"), tmp, { recursive: true });
  writeFileSync(join(tmp, ".nojekyll"), ""); // serve arquivos como estão (sem Jekyll)
  run("git init -q -b gh-pages", tmp);
  run("git add -A", tmp);
  run(`git -c user.name="AquaRush deploy" -c user.email="deploy@aquarush.local" commit -q -m "Deploy POC Babylon ${version} (${sha})"`, tmp);
  run(`git push -q --force "${origin}" gh-pages`, tmp);
  const m = origin.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  console.log(`\nPublicado: ${m ? `https://${m[1]}.github.io/${m[2]}/` : "(veja Settings → Pages do repositório)"}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
