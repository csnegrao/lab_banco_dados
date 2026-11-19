// Abre a página do aluno num navegador automático e lê o contrato de data-testid.
// Uso: node corretor_front.js <url> <nome_teste> <cpf_teste> <id_setor>
const { chromium } = require('playwright');
(async () => {
  const [url, nome, cpf, setor] = process.argv.slice(2);
  const out = { carregou: false, apuracao: [], candidatos: [], enviou: false, erro: null };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
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
