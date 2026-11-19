import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { ensureSchema } from "./backend/db.js";
import { clientIp } from "./backend/security.js";
import alunoRoutes from "./backend/routes/aluno.js";
import adminRoutes from "./backend/routes/admin.js";
import { iniciarCorretor } from "./backend/services/correcao.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", false); // IP real vem de X-Real-IP/cf-connecting-ip (backend/security.ts)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "64kb" }));

// Limite por sessão (token) e, sem token, por IP: a turma inteira pode sair pelo mesmo IP do campus.
const chave = (req: express.Request) => {
  const auth = req.headers.authorization;
  return auth ? "t:" + createHash("sha1").update(auth).digest("hex") : "ip:" + clientIp(req);
};
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, keyGenerator: chave, validate: false, standardHeaders: true, legacyHeaders: false,
  message: { message: "Muitas requisições em pouco tempo. Aguarde alguns segundos." } }));

const distDir = path.join(dir, "dist");
const indexFile = path.join(distDir, "index.html");
const buildId = () => { try { return createHash("sha1").update(fs.readFileSync(indexFile)).digest("hex").slice(0, 10); } catch { return "dev"; } };
app.get("/api/version", (_req, res) => res.json({ version: buildId() }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/admin", adminRoutes);
app.use("/api", alunoRoutes);
app.use("/api", (_req, res) => res.status(404).json({ message: "Rota não encontrada." }));

app.use(express.static(distDir, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-store"); } }));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (fs.existsSync(indexFile)) res.sendFile(indexFile);
  else res.status(503).send("Front-end não compilado. Rode npm run build.");
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ message: "Erro interno. Tente de novo em instantes." });
});

const port = Number(process.env.PORT || 3008);
ensureSchema()
  .then(() => {
    iniciarCorretor();
    app.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`Laboratório de Banco de Dados ouvindo na porta ${port}`));
  })
  .catch(e => { console.error("Falha ao preparar o banco:", e); process.exit(1); });
