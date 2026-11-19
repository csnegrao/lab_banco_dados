import net from "net";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET || JWT_SECRET.length < 16) throw new Error("Defina JWT_SECRET (16+ caracteres) no .env");

export interface AlunoToken { kind: "aluno"; uid: number; mat: string; nome: string }
export interface AdminToken { kind: "admin"; uid: number; nome: string; role: string }

export const signAluno = (p: Omit<AlunoToken, "kind">) => jwt.sign({ kind: "aluno", ...p }, JWT_SECRET, { expiresIn: "12h" });
export const signAdmin = (p: Omit<AdminToken, "kind">) => jwt.sign({ kind: "admin", ...p }, JWT_SECRET, { expiresIn: "12h" });

function readToken(req: Request): any | null {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

export function requireAluno(req: Request, res: Response, next: NextFunction) {
  const t = readToken(req);
  if (!t || t.kind !== "aluno") return res.status(401).json({ message: "Sessão expirada. Entre novamente." });
  (req as any).aluno = t as AlunoToken;
  next();
}
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const t = readToken(req);
  if (!t || t.kind !== "admin") return res.status(401).json({ message: "Sessão expirada. Entre novamente." });
  (req as any).admin = t as AdminToken;
  next();
}

/** Matrícula como no LabRedes/EduTest: só dígitos, últimos 8. */
export function normalizarMatricula(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length > 8 ? d.slice(-8) : d;
}

// ---------- IP real (nginx → X-Real-IP; Cloudflare → cf-connecting-ip só se veio de um edge) ----------
const CLOUDFLARE = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];
const cf = new net.BlockList();
for (const e of CLOUDFLARE) { const [a, b] = e.split("/"); cf.addSubnet(a, Number(b), net.isIPv6(a) ? "ipv6" : "ipv4"); }
const normalize = (ip: string) => ip.trim().replace(/^::ffff:/, "");

export function clientIp(req: Request): string {
  const peer = normalize((req.headers["x-real-ip"] as string) || req.socket?.remoteAddress || "");
  const cfIp = req.headers["cf-connecting-ip"] as string | undefined;
  if (cfIp && net.isIP(peer) && cf.check(peer, net.isIPv6(peer) ? "ipv6" : "ipv4")) return normalize(cfIp);
  return peer;
}
