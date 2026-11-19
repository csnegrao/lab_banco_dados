import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { marked } from "marked";

const run = promisify(execFile);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PYTHON = process.env.PYTHON_BIN || path.join(RAIZ, ".venv", "bin", "python");
const CACHE = path.join(RAIZ, "data", "cargas");

/** Script de carga do aluno (determinístico por matrícula), gerado por carga/gerar_carga.py. */
export async function cargaDoAluno(matricula: string): Promise<string> {
  if (!/^[0-9A-Za-z]{1,20}$/.test(matricula)) throw new Error("matrícula inválida");
  const arq = path.join(CACHE, `carga_${matricula}.sql`);
  if (!fs.existsSync(arq)) {
    fs.mkdirSync(CACHE, { recursive: true });
    await run(PYTHON, [path.join(RAIZ, "carga", "gerar_carga.py"), matricula, CACHE], { timeout: 30_000 });
  }
  return fs.readFileSync(arq, "utf8");
}

const htmlCache = new Map<string, { mtime: number; html: string }>();
/** Enunciado (enunciado/N1.md ou N2.md) em HTML. O conteúdo é nosso (do repositório). */
export function enunciadoHtml(tipo: "N1" | "N2"): string {
  const arq = path.join(RAIZ, "enunciado", `${tipo}.md`);
  const mtime = fs.statSync(arq).mtimeMs;
  const c = htmlCache.get(tipo);
  if (c && c.mtime === mtime) return c.html;
  let md = fs.readFileSync(arq, "utf8");
  // a N2 remete à N1: inclui a parte de banco no mesmo texto
  if (tipo === "N2") md = md.replace(/Faça \*\*toda\*\* a avaliação de banco descrita em \[`N1.md`\]\(N1.md\) \(Partes 0, 1 e 2\)\./,
    "Faça **toda** a avaliação de banco abaixo (Partes 0, 1 e 2).\n\n" +
    fs.readFileSync(path.join(RAIZ, "enunciado", "N1.md"), "utf8").replace(/^# .*\n/, "").replace(/\n## Entrega[\s\S]*$/, "").replace(/^## /gm, "### "));
  const html = marked.parse(md, { async: false }) as string;
  htmlCache.set(tipo, { mtime, html });
  return html;
}
