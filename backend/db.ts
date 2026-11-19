import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const env = process.env;

// Banco próprio da plataforma (leitura e escrita)
export const pool = mysql.createPool({
  host: env.DB_HOST || "localhost",
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || "root",
  password: env.DB_PASSWORD || "",
  database: env.DB_NAME || "sql_labbd",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  timezone: "local",
});

// Banco do EduTest: SOMENTE LEITURA (usuário MySQL com SELECT em users/subjects/enrollments)
export const edutest = mysql.createPool({
  host: env.EDUTEST_DB_HOST || env.DB_HOST || "localhost",
  port: Number(env.EDUTEST_DB_PORT || env.DB_PORT || 3306),
  user: env.EDUTEST_DB_USER || "root",
  password: env.EDUTEST_DB_PASSWORD || "",
  database: env.EDUTEST_DB_NAME || "sql_edutest_pro",
  waitForConnections: true,
  connectionLimit: 5,
  charset: "utf8mb4",
});

export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}
export async function exec(sql: string, params: any[] = []): Promise<mysql.ResultSetHeader> {
  const [res] = await pool.query(sql, params);
  return res as mysql.ResultSetHeader;
}
export async function eq<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await edutest.query(sql, params);
  return rows as T[];
}

/** JSON vindo do MySQL pode chegar como string (MariaDB) ou objeto (MySQL). */
export function js<T = any>(v: any, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  return v as T;
}

export async function ensureSchema() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(dir, "..", "database", "schema.sql"), "utf8");
  for (const st of sql.split(/;\s*\n/).map(s => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
    await pool.query(st);
  }
  // correção que estava rodando quando o processo caiu volta para a fila
  await pool.query("UPDATE bd_correcoes SET status='fila', iniciado_em=NULL WHERE status='rodando'");
}

export async function logEvento(tipo: string, detalhe: string | null, extra: { userId?: number | null; ip?: string } = {}) {
  await exec("INSERT INTO bd_eventos (tipo, detalhe, user_id, ip) VALUES (?,?,?,?)",
    [tipo, detalhe?.slice(0, 255) ?? null, extra.userId ?? null, extra.ip ?? null]);
}
