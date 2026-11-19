// Abre a página do aluno num navegador automático e lê o contrato de data-testid.
// Uso: node corretor_front.js <url> <nome_teste> <cpf_teste> <id_setor>
//
// Segurança: a página é de terceiros e roda no nosso servidor. Toda requisição dela
// (inclusive WebSocket) só sai se o destino for um IP público; nada de localhost/rede interna.
const dns = require('dns').promises;
const net = require('net');
const { chromium } = require('playwright');

const PRIVADOS = new net.BlockList();
for (const [a, b] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) PRIVADOS.addSubnet(a, b, 'ipv4');
for (const [a, b] of [['::', 127], ['::ffff:0:0', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVADOS.addSubnet(a, b, 'ipv6');
const PERMITIR_LOCAL = process.env.LABBD_PERMITIR_LOCAL === '1'; // só para testes automatizados

const cache = new Map();
async function destinoPublico(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (PERMITIR_LOCAL && (host === '127.0.0.1' || host === 'localhost')) return true;
  if (!cache.has(host)) {
    cache.set(host, (async () => {
      const ips = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true }).catch(() => []);
      return ips.length > 0 && ips.every(i => !PRIVADOS.check(i.address, i.family === 6 ? 'ipv6' : 'ipv4'));
    })());
  }
  return cache.get(host);
}

(async () => {
  const [url, nome, cpf, setor] = process.argv.slice(2);
  const out = { carregou: false, apuracao: [], candidatos: [], enviou: false, erro: null };
  const browser = await chromium.launch({ chromiumSandbox: false });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async route => (await destinoPublico(route.request().url())) ? route.continue() : route.abort('blockedbyclient'));
    await context.routeWebSocket(/.*/, async ws => { if (await destinoPublico(ws.url())) ws.connectToServer(); else ws.close(); });
    const page = await context.newPage();
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    out.carregou = !!resp && resp.ok();
    if (!out.carregou) out.erro = `HTTP ${resp && resp.status()}`;
    await page.waitForSelector('[data-testid="apuracao-linha"]', { timeout: 15000 }).catch(() => {});
    out.apuracao = await page.$$eval('[data-testid="apuracao-linha"]', ls => ls.map(l => ({
      numero: (l.querySelector('[data-testid="numero-chapa"]') || {}).textContent || '',
      total: (l.querySelector('[data-testid="total-votos"]') || {}).textContent || '' })));
    out.candidatos = await page.$$eval('[data-testid="candidato"] [data-testid="nome-candidato"]',
      ns => ns.map(n => n.textContent.trim()));
    const form = await page.$('[data-testid="form-eleitor"]');
    if (form) {
      await page.fill('[data-testid="form-eleitor"] [name="nome_eleitor"]', nome).catch(() => {});
      await page.fill('[data-testid="form-eleitor"] [name="cpf"]', cpf).catch(() => {});
      await page.fill('[data-testid="form-eleitor"] [name="idade"]', '30').catch(() => {});
      await page.selectOption('[data-testid="form-eleitor"] [name="id_setor"]', setor).catch(() => {});
      await page.click('[data-testid="form-eleitor"] [type="submit"]', { timeout: 5000 });
      out.enviou = true;
      await page.waitForTimeout(4000);
    }
    if (erros.length && !out.erro) out.erro = 'erro de JS: ' + erros[0].slice(0, 150);
  } catch (e) { out.erro = String(e.message || e).slice(0, 200); }
  await browser.close();
  console.log(JSON.stringify(out));
})();
