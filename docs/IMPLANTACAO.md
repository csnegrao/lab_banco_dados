# Implantação da plataforma (servidor sl20)

- Pasta: `/www/wwwroot/lab_banco_dados` (dono `www`), porta **3008**, PM2 `LabBD`.
- Bancos: MySQL `sql_labbd` (leitura e escrita) e usuário `labbd_ro` só com SELECT em
  `sql_edutest_pro.users/subjects/enrollments`.
- Fora do git: `.env` e `corretor/gabarito_ref.py`.

## Instalar / atualizar

```bash
cd /www/wwwroot/lab_banco_dados
git pull
python3 -m venv .venv && .venv/bin/pip install -r corretor/requirements.txt
export PATH=/www/server/nodejs/v24.14.1/bin:$PATH
npm ci --registry=https://registry.npmjs.org
(cd corretor && npm ci --registry=https://registry.npmjs.org && PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers npx playwright install chromium-headless-shell)
npm run build
chown -R www:www .
pm2 restart LabBD --update-env    # primeira vez: ver abaixo
```

Primeira vez:

```bash
pm2 start node_modules/.bin/tsx --name LabBD --interpreter /www/server/nodejs/v24.14.1/bin/node -- server.ts
pm2 save
```

## .env

```
PORT=3008
HOST=127.0.0.1
JWT_SECRET=...            # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DB_HOST=localhost
DB_USER=sql_labbd
DB_PASSWORD=...
DB_NAME=sql_labbd
EDUTEST_DB_HOST=localhost
EDUTEST_DB_USER=labbd_ro
EDUTEST_DB_PASSWORD=...
EDUTEST_DB_NAME=sql_edutest_pro
CORRECOES_SIMULTANEAS=2
CORRETOR_UID=1001          # www: o corretor roda sem privilégios
CORRETOR_GID=1001
```

Nunca durante uma correção em andamento: `pm2 restart` interrompe a correção, que volta para a fila.
