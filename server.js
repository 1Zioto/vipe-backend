// ============================================================
//  VIPE TRANSPORTES — Backend (Express + MySQL)
//  Coloque este arquivo no repositório vipe-backend
//  Instale: npm install express mysql2 cors bcryptjs jsonwebtoken
// ============================================================

const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ──────────────────────────────────────────────────────────────────────
// ESTE É O FIX PRINCIPAL: permite que vipesistemas.com.br faça requisições
const ALLOWED_ORIGINS = [
  'https://www.vipesistemas.com.br',
  'https://vipesistemas.com.br',
  'https://vipe-transportes.vercel.app',
  process.env.FRONTEND_URL,   // variável de ambiente extra (opcional)
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin não permitida — ' + origin));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// ─── BANCO DE DADOS ────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               process.env.DB_HOST || '98.80.70.12',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER || 'douglas',
  password:           process.env.DB_PASS || '6352441@Ab',
  database:           process.env.DB_NAME || 'vipe_transportes',
  waitForConnections: true,
  connectionLimit:    10,
  timezone:           '-03:00',
});

// ─── JWT ───────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'vipe_secret_2024';

function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não informado' });
  }
  try {
    req.usuario = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido ou expirado' });
  }
}

// ─── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ message: 'E-mail e senha obrigatórios' });
  try {
    const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(senha, u.senha))) {
      return res.status(401).json({ message: 'Credenciais inválidas' });
    }
    const token = jwt.sign(
      { id: u.id, email: u.email, cargo: u.cargo },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, usuario: { id: u.id, nome: u.nome, email: u.email, cargo: u.cargo } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/auth/me', autenticar, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id,nome,email,cargo FROM usuarios WHERE id=?', [req.usuario.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── STATS ─────────────────────────────────────────────────────────────────────
app.get('/stats', autenticar, async (req, res) => {
  try {
    const [[r1]] = await pool.query("SELECT COUNT(*) as v FROM embarques");
    const [[r2]] = await pool.query("SELECT COUNT(*) as v FROM embarques WHERE status='Pendente'");
    const [[r3]] = await pool.query("SELECT COUNT(*) as v FROM embarques WHERE status='Em Transporte'");
    const [[r4]] = await pool.query("SELECT COUNT(*) as v FROM embarques WHERE status='Entregue'");
    const [[r5]] = await pool.query("SELECT COUNT(*) as v FROM tarefas WHERE status IN ('pendente','em_andamento')");
    const [[r6]] = await pool.query("SELECT COUNT(*) as v FROM tarefas WHERE prioridade='urgente' AND status NOT IN ('concluida','cancelada')");
    const [[r7]] = await pool.query("SELECT COUNT(*) as v FROM ctes WHERE status='pendente'");
    res.json({
      total: r1.v, pendentes: r2.v, em_transporte: r3.v, entregues: r4.v,
      tarefas_pendentes: r5.v, tarefas_urgentes: r6.v, ctes_pendentes: r7.v
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── CRUD FACTORY ──────────────────────────────────────────────────────────────
function makeCrud(tabela, campos) {
  const r = express.Router();

  r.get('/', autenticar, async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM ${tabela} ORDER BY id DESC`);
      res.json(rows);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  r.post('/', autenticar, async (req, res) => {
    try {
      const d = {};
      campos.forEach(c => { if (req.body[c] !== undefined) d[c] = req.body[c]; });
      const [result] = await pool.query(`INSERT INTO ${tabela} SET ?`, [d]);
      const [rows]   = await pool.query(`SELECT * FROM ${tabela} WHERE id=?`, [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  r.put('/:id', autenticar, async (req, res) => {
    try {
      const d = {};
      campos.forEach(c => { if (req.body[c] !== undefined) d[c] = req.body[c]; });
      await pool.query(`UPDATE ${tabela} SET ? WHERE id=?`, [d, req.params.id]);
      const [rows] = await pool.query(`SELECT * FROM ${tabela} WHERE id=?`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  r.delete('/:id', autenticar, async (req, res) => {
    try {
      await pool.query(`DELETE FROM ${tabela} WHERE id=?`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ message: err.message }); }
  });

  return r;
}

// ─── ROTAS CRUD SIMPLES ────────────────────────────────────────────────────────
app.use('/clientes',    makeCrud('clientes',    ['nome','cnpj','contato','email']));
app.use('/armadores',   makeCrud('armadores',   ['nome','codigo']));
app.use('/armazens',    makeCrud('armazens',    ['nome','municipio','uf','endereco']));
app.use('/destinos',    makeCrud('destinos',    ['pais','porto','codigo']));
app.use('/mercadorias', makeCrud('mercadorias', ['descricao','ncm','unidade']));
app.use('/motoristas',  makeCrud('motoristas',  ['nome','cpf','cnh','telefone']));
app.use('/veiculos',    makeCrud('veiculos',    ['placa','tipo','modelo','ano']));
app.use('/empresas',    makeCrud('empresas',    ['razao_social','cnpj','cidade','uf']));
app.use('/tarefas',     makeCrud('tarefas',     ['titulo','descricao','responsavel','embarque_id','prioridade','status','data_vencimento','created_by']));
app.use('/ctes',        makeCrud('ctes',        ['numero_cte','embarque_id','empresa_id','valor','data_emissao','status','observacoes']));

// ─── EMBARQUES (com JOIN para buscar nomes) ────────────────────────────────────
const CAMPOS_EMBARQUE = ['booking','contrato','cliente_id','armador_id','armazem_id','destino_id',
  'mercadoria_id','municipio','uf','navio','quantCntr','embalagem','quantTotal',
  'pesoLiquido','pesoBruto','dataColeta','dataCarreg','status','fito','fumigacao',
  'higienizacao','forracaoDupla'];

const embRouter = express.Router();

embRouter.get('/', autenticar, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT e.*,
        c.nome       AS cliente,
        a.nome       AS armador,
        ar.nome      AS armazem,
        d.pais       AS destino,
        m.descricao  AS mercadoria
      FROM embarques e
      LEFT JOIN clientes    c  ON e.cliente_id    = c.id
      LEFT JOIN armadores   a  ON e.armador_id    = a.id
      LEFT JOIN armazens    ar ON e.armazem_id    = ar.id
      LEFT JOIN destinos    d  ON e.destino_id    = d.id
      LEFT JOIN mercadorias m  ON e.mercadoria_id = m.id
      ORDER BY e.id DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

embRouter.post('/', autenticar, async (req, res) => {
  try {
    const d = {};
    CAMPOS_EMBARQUE.forEach(c => { if (req.body[c] !== undefined) d[c] = req.body[c]; });
    const [result] = await pool.query('INSERT INTO embarques SET ?', [d]);
    const [rows]   = await pool.query('SELECT * FROM embarques WHERE id=?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

embRouter.put('/:id', autenticar, async (req, res) => {
  try {
    const d = {};
    CAMPOS_EMBARQUE.forEach(c => { if (req.body[c] !== undefined) d[c] = req.body[c]; });
    await pool.query('UPDATE embarques SET ? WHERE id=?', [d, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM embarques WHERE id=?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

embRouter.delete('/:id', autenticar, async (req, res) => {
  try {
    await pool.query('DELETE FROM embarques WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.use('/embarques', embRouter);

// ─── USUÁRIOS ──────────────────────────────────────────────────────────────────
const usrRouter = express.Router();
usrRouter.get('/', autenticar, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id,nome,email,cargo,created_at FROM usuarios ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ message: err.message }); }
});
usrRouter.post('/', autenticar, async (req, res) => {
  try {
    const { nome, email, senha, cargo } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ message: 'Nome, e-mail e senha obrigatórios' });
    const hash = await bcrypt.hash(senha, 10);
    const [r] = await pool.query('INSERT INTO usuarios (nome,email,senha,cargo) VALUES (?,?,?,?)', [nome, email, hash, cargo]);
    res.status(201).json({ id: r.insertId, nome, email, cargo });
  } catch (err) { res.status(500).json({ message: err.message }); }
});
usrRouter.put('/:id', autenticar, async (req, res) => {
  try {
    const { nome, email, senha, cargo } = req.body;
    if (senha) {
      const hash = await bcrypt.hash(senha, 10);
      await pool.query('UPDATE usuarios SET nome=?,email=?,senha=?,cargo=? WHERE id=?', [nome, email, hash, cargo, req.params.id]);
    } else {
      await pool.query('UPDATE usuarios SET nome=?,email=?,cargo=? WHERE id=?', [nome, email, cargo, req.params.id]);
    }
    const [rows] = await pool.query('SELECT id,nome,email,cargo FROM usuarios WHERE id=?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ message: err.message }); }
});
usrRouter.delete('/:id', autenticar, async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});
app.use('/usuarios', usrRouter);

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Vipe API rodando na porta ${PORT}`);
  console.log(`    CORS liberado para: ${ALLOWED_ORIGINS.join(' | ')}`);
});
