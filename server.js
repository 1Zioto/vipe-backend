/**
 * Backend - Vipe Transportes
 * Express + MySQL2 + JWT Auth
 * Inclui: Embarques, Tarefas, Frota, CTEs e CRUDs auxiliares
 */

const express    = require('express');
const cors       = require('cors');
const mysql      = require('mysql2/promise');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vipe_secret_2024';

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json());

// ─── MySQL POOL ───────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '98.80.70.12',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'douglas',
  password: process.env.DB_PASS     || '6352441@Ab',
  database: process.env.DB_NAME     || 'vipe_transportes',
  waitForConnections: true,
  connectionLimit:    10,
  timezone: '-03:00',
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ message: 'Token não fornecido' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido ou expirado' });
  }
}

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── INICIALIZAR TABELAS ──────────────────────────────────────────────────────
async function initDB() {
  // Usuarios
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      nome       VARCHAR(100) NOT NULL,
      email      VARCHAR(150) NOT NULL UNIQUE,
      senha_hash VARCHAR(255) NOT NULL,
      cargo      VARCHAR(80) DEFAULT 'Operador',
      ativo      TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabelas de referência
  const tabelas = [
    `CREATE TABLE IF NOT EXISTS clientes (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(150) NOT NULL, cnpj VARCHAR(20), contato VARCHAR(100), email VARCHAR(150), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS armadores (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(150) NOT NULL, codigo VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS armazens (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(150) NOT NULL, municipio VARCHAR(100), uf VARCHAR(2), endereco VARCHAR(200), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS destinos (id INT AUTO_INCREMENT PRIMARY KEY, pais VARCHAR(100) NOT NULL, porto VARCHAR(100), codigo VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS mercadorias (id INT AUTO_INCREMENT PRIMARY KEY, descricao VARCHAR(200) NOT NULL, ncm VARCHAR(20), unidade VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS motoristas (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(150) NOT NULL, cpf VARCHAR(20), cnh VARCHAR(30), telefone VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS veiculos (id INT AUTO_INCREMENT PRIMARY KEY, placa VARCHAR(10) NOT NULL, tipo VARCHAR(50), modelo VARCHAR(80), ano INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS empresas (id INT AUTO_INCREMENT PRIMARY KEY, razao_social VARCHAR(200) NOT NULL, cnpj VARCHAR(20), cidade VARCHAR(100), uf VARCHAR(2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  ];
  for (const sql of tabelas) await pool.execute(sql);

  // Embarques
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS embarques (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      booking      VARCHAR(50),
      contrato     VARCHAR(50),
      cliente_id   INT,
      armador_id   INT,
      armazem_id   INT,
      destino_id   INT,
      mercadoria_id INT,
      municipio    VARCHAR(100),
      uf           VARCHAR(2),
      navio        VARCHAR(100),
      quant_cntr   INT,
      embalagem    VARCHAR(50),
      quant_total  DECIMAL(10,2),
      peso_liquido DECIMAL(10,2),
      peso_bruto   DECIMAL(10,2),
      data_coleta  DATE,
      data_carreg  DATE,
      status       VARCHAR(50) DEFAULT 'Pendente',
      fito         TINYINT(1) DEFAULT 0,
      fumigacao    TINYINT(1) DEFAULT 0,
      higienizacao TINYINT(1) DEFAULT 0,
      forracao_dupla TINYINT(1) DEFAULT 0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cliente_id)    REFERENCES clientes(id)    ON DELETE SET NULL,
      FOREIGN KEY (armador_id)    REFERENCES armadores(id)   ON DELETE SET NULL,
      FOREIGN KEY (armazem_id)    REFERENCES armazens(id)    ON DELETE SET NULL,
      FOREIGN KEY (destino_id)    REFERENCES destinos(id)    ON DELETE SET NULL,
      FOREIGN KEY (mercadoria_id) REFERENCES mercadorias(id) ON DELETE SET NULL
    )
  `);

  // Embarque Status
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS embarque_status (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      embarque_id INT NOT NULL,
      status      VARCHAR(50),
      data        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (embarque_id) REFERENCES embarques(id) ON DELETE CASCADE
    )
  `);

  // Embarque Transporte
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS embarque_transporte (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      embarque_id  INT NOT NULL,
      motorista_id INT,
      veiculo_id   INT,
      empresa_id   INT,
      data_saida   DATE,
      data_chegada DATE,
      status       VARCHAR(50) DEFAULT 'Pendente',
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (embarque_id)  REFERENCES embarques(id)  ON DELETE CASCADE,
      FOREIGN KEY (motorista_id) REFERENCES motoristas(id) ON DELETE SET NULL,
      FOREIGN KEY (veiculo_id)   REFERENCES veiculos(id)   ON DELETE SET NULL,
      FOREIGN KEY (empresa_id)   REFERENCES empresas(id)   ON DELETE SET NULL
    )
  `);

  // Tarefas Pendentes
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tarefas (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      titulo       VARCHAR(200) NOT NULL,
      descricao    TEXT,
      responsavel  VARCHAR(150),
      embarque_id  INT,
      prioridade   ENUM('baixa','media','alta','urgente') DEFAULT 'media',
      status       ENUM('pendente','em_andamento','concluida','cancelada') DEFAULT 'pendente',
      data_vencimento DATE,
      created_by   INT,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (embarque_id) REFERENCES embarques(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by)  REFERENCES usuarios(id)  ON DELETE SET NULL
    )
  `);

  // CTEs
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ctes (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      numero_cte   VARCHAR(50) NOT NULL,
      embarque_id  INT,
      empresa_id   INT,
      valor        DECIMAL(12,2),
      data_emissao DATE,
      status       ENUM('pendente','aprovado','cancelado') DEFAULT 'pendente',
      observacoes  TEXT,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (embarque_id) REFERENCES embarques(id) ON DELETE SET NULL,
      FOREIGN KEY (empresa_id)  REFERENCES empresas(id)  ON DELETE SET NULL
    )
  `);

  // Permissões por módulo
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS usuario_permissoes (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      modulo     VARCHAR(50) NOT NULL,
      nivel      ENUM('none','read','write') DEFAULT 'none',
      UNIQUE KEY uk_usuario_modulo (usuario_id, modulo),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
  `);

  // Admin padrão
  const [rows] = await pool.execute('SELECT id FROM usuarios WHERE email = ?', ['admin@vipe.com.br']);
  if (rows.length === 0) {
    const hash = await bcrypt.hash('vipe@2024', 10);
    await pool.execute(
      'INSERT INTO usuarios (nome, email, senha_hash, cargo) VALUES (?, ?, ?, ?)',
      ['Administrador', 'admin@vipe.com.br', hash, 'Administrador']
    );
    console.log('✅ Usuário padrão criado: admin@vipe.com.br / vipe@2024');
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

app.post('/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
  try {
    const [rows] = await pool.execute('SELECT * FROM usuarios WHERE email = ? AND ativo = 1', [email]);
    if (rows.length === 0) return res.status(401).json({ message: 'Credenciais inválidas' });
    const usuario = rows[0];
    const ok = await bcrypt.compare(senha, usuario.senha_hash);
    if (!ok) return res.status(401).json({ message: 'Credenciais inválidas' });
    const token = jwt.sign(
      { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/auth/me', authMiddleware, (req, res) => res.json({ usuario: req.user }));

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────

app.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM embarques');
    const [[{ pendentes }]] = await pool.execute("SELECT COUNT(*) AS pendentes FROM embarques WHERE status = 'Pendente'");
    const [[{ em_transporte }]] = await pool.execute("SELECT COUNT(*) AS em_transporte FROM embarques WHERE status = 'Em Transporte'");
    const [[{ entregues }]] = await pool.execute("SELECT COUNT(*) AS entregues FROM embarques WHERE status = 'Entregue'");
    const [[{ tarefas_pendentes }]] = await pool.execute("SELECT COUNT(*) AS tarefas_pendentes FROM tarefas WHERE status = 'pendente'");
    const [[{ tarefas_urgentes }]] = await pool.execute("SELECT COUNT(*) AS tarefas_urgentes FROM tarefas WHERE status != 'concluida' AND prioridade = 'urgente'");
    const [[{ ctes_pendentes }]] = await pool.execute("SELECT COUNT(*) AS ctes_pendentes FROM ctes WHERE status = 'pendente'");
    res.json({ total, pendentes, em_transporte, entregues, tarefas_pendentes, tarefas_urgentes, ctes_pendentes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── EMBARQUES ────────────────────────────────────────────────────────────────

app.get('/embarques', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT e.id, e.booking, e.contrato, e.municipio, e.uf, e.navio,
        e.quant_cntr AS quantCntr, e.embalagem,
        e.quant_total AS quantTotal, e.peso_liquido AS pesoLiquido,
        e.peso_bruto AS pesoBruto, e.data_coleta AS dataColeta,
        e.data_carreg AS dataCarreg, e.status,
        e.fito, e.fumigacao, e.higienizacao, e.forracao_dupla AS forracaoDupla,
        e.created_at AS createdAt, e.updated_at AS updatedAt,
        c.id AS cliente_id, c.nome AS cliente,
        a.id AS armador_id, a.nome AS armador,
        ar.id AS armazem_id, ar.nome AS armazem,
        d.id AS destino_id, d.porto AS destino,
        m.id AS mercadoria_id, m.descricao AS mercadoria
      FROM embarques e
      LEFT JOIN clientes    c  ON e.cliente_id    = c.id
      LEFT JOIN armadores   a  ON e.armador_id    = a.id
      LEFT JOIN armazens    ar ON e.armazem_id    = ar.id
      LEFT JOIN destinos    d  ON e.destino_id    = d.id
      LEFT JOIN mercadorias m  ON e.mercadoria_id = m.id
      ORDER BY e.id DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/buscar', authMiddleware, async (req, res) => {
  const { booking, contrato } = req.query;
  try {
    let sql = `SELECT e.*, c.nome AS cliente, a.nome AS armador, ar.nome AS armazem, d.porto AS destino, m.descricao AS mercadoria
      FROM embarques e LEFT JOIN clientes c ON e.cliente_id=c.id LEFT JOIN armadores a ON e.armador_id=a.id
      LEFT JOIN armazens ar ON e.armazem_id=ar.id LEFT JOIN destinos d ON e.destino_id=d.id LEFT JOIN mercadorias m ON e.mercadoria_id=m.id WHERE 1=1`;
    const params = [];
    if (booking)  { sql += ' AND e.booking = ?';  params.push(booking); }
    if (contrato) { sql += ' AND e.contrato = ?'; params.push(contrato); }
    const [rows] = await pool.execute(sql, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Embarque não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/embarques', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const [result] = await pool.execute(`
      INSERT INTO embarques (booking,contrato,cliente_id,armador_id,armazem_id,destino_id,mercadoria_id,
        municipio,uf,navio,quant_cntr,embalagem,quant_total,peso_liquido,peso_bruto,
        data_coleta,data_carreg,status,fito,fumigacao,higienizacao,forracao_dupla)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [d.booking||null,d.contrato||null,d.cliente_id||null,d.armador_id||null,d.armazem_id||null,
        d.destino_id||null,d.mercadoria_id||null,d.municipio||null,d.uf||null,d.navio||null,
        d.quantCntr||null,d.embalagem||null,d.quantTotal||null,d.pesoLiquido||null,d.pesoBruto||null,
        d.dataColeta||null,d.dataCarreg||null,d.status||'Pendente',
        d.fito?1:0,d.fumigacao?1:0,d.higienizacao?1:0,d.forracaoDupla?1:0]);
    const [novo] = await pool.execute('SELECT * FROM embarques WHERE id = ?', [result.insertId]);
    res.status(201).json(novo[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/embarques/:id', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    await pool.execute(`
      UPDATE embarques SET booking=?,contrato=?,cliente_id=?,armador_id=?,armazem_id=?,destino_id=?,
        mercadoria_id=?,municipio=?,uf=?,navio=?,quant_cntr=?,embalagem=?,quant_total=?,
        peso_liquido=?,peso_bruto=?,data_coleta=?,data_carreg=?,status=?,fito=?,fumigacao=?,
        higienizacao=?,forracao_dupla=?,updated_at=NOW() WHERE id=?
    `, [d.booking||null,d.contrato||null,d.cliente_id||null,d.armador_id||null,d.armazem_id||null,
        d.destino_id||null,d.mercadoria_id||null,d.municipio||null,d.uf||null,d.navio||null,
        d.quantCntr||null,d.embalagem||null,d.quantTotal||null,d.pesoLiquido||null,d.pesoBruto||null,
        d.dataColeta||null,d.dataCarreg||null,d.status||'Pendente',
        d.fito?1:0,d.fumigacao?1:0,d.higienizacao?1:0,d.forracaoDupla?1:0,req.params.id]);
    const [updated] = await pool.execute('SELECT * FROM embarques WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/embarques/:id', authMiddleware, async (req, res) => {
  try {
    await pool.execute('DELETE FROM embarques WHERE id = ?', [req.params.id]);
    res.json({ message: 'Embarque removido' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TAREFAS ──────────────────────────────────────────────────────────────────

app.get('/tarefas', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT t.*, e.booking AS embarque_booking, u.nome AS criado_por
      FROM tarefas t
      LEFT JOIN embarques e ON t.embarque_id = e.id
      LEFT JOIN usuarios  u ON t.created_by  = u.id
      ORDER BY FIELD(t.prioridade,'urgente','alta','media','baixa'), t.data_vencimento ASC, t.id DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/tarefas', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const [result] = await pool.execute(
      'INSERT INTO tarefas (titulo,descricao,responsavel,embarque_id,prioridade,status,data_vencimento,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [d.titulo,d.descricao||null,d.responsavel||null,d.embarque_id||null,d.prioridade||'media',d.status||'pendente',d.data_vencimento||null,req.user.id]
    );
    res.status(201).json({ id: result.insertId, ...d });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/tarefas/:id', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    await pool.execute(
      'UPDATE tarefas SET titulo=?,descricao=?,responsavel=?,embarque_id=?,prioridade=?,status=?,data_vencimento=?,updated_at=NOW() WHERE id=?',
      [d.titulo,d.descricao||null,d.responsavel||null,d.embarque_id||null,d.prioridade||'media',d.status||'pendente',d.data_vencimento||null,req.params.id]
    );
    const [updated] = await pool.execute('SELECT * FROM tarefas WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/tarefas/:id', authMiddleware, async (req, res) => {
  try {
    await pool.execute('DELETE FROM tarefas WHERE id = ?', [req.params.id]);
    res.json({ message: 'Tarefa removida' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CTEs ─────────────────────────────────────────────────────────────────────

app.get('/ctes', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.*, e.booking AS embarque_booking, em.razao_social AS empresa_nome
      FROM ctes c
      LEFT JOIN embarques e ON c.embarque_id = e.id
      LEFT JOIN empresas em ON c.empresa_id  = em.id
      ORDER BY c.id DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/ctes', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const [result] = await pool.execute(
      'INSERT INTO ctes (numero_cte,embarque_id,empresa_id,valor,data_emissao,status,observacoes) VALUES (?,?,?,?,?,?,?)',
      [d.numero_cte,d.embarque_id||null,d.empresa_id||null,d.valor||null,d.data_emissao||null,d.status||'pendente',d.observacoes||null]
    );
    res.status(201).json({ id: result.insertId, ...d });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/ctes/:id', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    await pool.execute(
      'UPDATE ctes SET numero_cte=?,embarque_id=?,empresa_id=?,valor=?,data_emissao=?,status=?,observacoes=? WHERE id=?',
      [d.numero_cte,d.embarque_id||null,d.empresa_id||null,d.valor||null,d.data_emissao||null,d.status||'pendente',d.observacoes||null,req.params.id]
    );
    const [updated] = await pool.execute('SELECT * FROM ctes WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/ctes/:id', authMiddleware, async (req, res) => {
  try {
    await pool.execute('DELETE FROM ctes WHERE id = ?', [req.params.id]);
    res.json({ message: 'CTE removido' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STATUS / TRANSPORTES DE EMBARQUE ─────────────────────────────────────────

app.get('/embarques/:id/status', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM embarque_status WHERE embarque_id=? ORDER BY data DESC', [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/embarques/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  try {
    await pool.execute('INSERT INTO embarque_status (embarque_id,status) VALUES (?,?)', [req.params.id, status]);
    await pool.execute('UPDATE embarques SET status=?,updated_at=NOW() WHERE id=?', [status, req.params.id]);
    res.status(201).json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/embarques/:id/transportes', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT et.*, mo.nome AS motorista, ve.placa AS veiculo, ve.modelo AS veiculo_modelo, em.razao_social AS empresa
      FROM embarque_transporte et
      LEFT JOIN motoristas mo ON et.motorista_id=mo.id
      LEFT JOIN veiculos ve ON et.veiculo_id=ve.id
      LEFT JOIN empresas em ON et.empresa_id=em.id
      WHERE et.embarque_id=? ORDER BY et.id DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/embarques/:id/transportes', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const [result] = await pool.execute(
      'INSERT INTO embarque_transporte (embarque_id,motorista_id,veiculo_id,empresa_id,data_saida,data_chegada,status) VALUES (?,?,?,?,?,?,?)',
      [req.params.id,d.motorista_id||null,d.veiculo_id||null,d.empresa_id||null,d.data_saida||null,d.data_chegada||null,d.status||'Pendente']
    );
    res.status(201).json({ id: result.insertId, ...d });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CRUD GENÉRICO ────────────────────────────────────────────────────────────
const crudRoutes = [
  { path: '/motoristas',  table: 'motoristas'  },
  { path: '/veiculos',    table: 'veiculos'    },
  { path: '/empresas',    table: 'empresas'    },
  { path: '/clientes',    table: 'clientes'    },
  { path: '/armadores',   table: 'armadores'   },
  { path: '/mercadorias', table: 'mercadorias' },
  { path: '/armazens',    table: 'armazens'    },
  { path: '/destinos',    table: 'destinos'    },
];

crudRoutes.forEach(({ path: routePath, table }) => {
  app.get(routePath, authMiddleware, async (req, res) => {
    try { const [rows] = await pool.execute(`SELECT * FROM ${table} ORDER BY id DESC`); res.json(rows); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.get(`${routePath}/:id`, authMiddleware, async (req, res) => {
    try {
      const [rows] = await pool.execute(`SELECT * FROM ${table} WHERE id=?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
      res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post(routePath, authMiddleware, async (req, res) => {
    try {
      const cols = Object.keys(req.body); const vals = Object.values(req.body);
      const [result] = await pool.execute(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, vals);
      res.status(201).json({ id: result.insertId, ...req.body });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.put(`${routePath}/:id`, authMiddleware, async (req, res) => {
    try {
      const setCols = Object.keys(req.body).map(c => `${c}=?`).join(',');
      await pool.execute(`UPDATE ${table} SET ${setCols} WHERE id=?`, [...Object.values(req.body), req.params.id]);
      res.json({ id: req.params.id, ...req.body });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.delete(`${routePath}/:id`, authMiddleware, async (req, res) => {
    try { await pool.execute(`DELETE FROM ${table} WHERE id=?`, [req.params.id]); res.json({ message: 'Removido' }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
});

// ─── USUÁRIOS ─────────────────────────────────────────────────────────────────

app.get('/usuarios', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id,nome,email,cargo,ativo,created_at FROM usuarios ORDER BY id DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/usuarios', authMiddleware, async (req, res) => {
  const { nome, email, senha, cargo } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ message: 'nome, email e senha são obrigatórios' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    const [result] = await pool.execute('INSERT INTO usuarios (nome,email,senha_hash,cargo) VALUES (?,?,?,?)', [nome,email,hash,cargo||'Operador']);
    res.status(201).json({ id: result.insertId, nome, email, cargo: cargo||'Operador' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/usuarios/:id/senha', authMiddleware, async (req, res) => {
  const { senha } = req.body;
  if (!senha) return res.status(400).json({ message: 'Nova senha obrigatória' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    await pool.execute('UPDATE usuarios SET senha_hash=? WHERE id=?', [hash, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/usuarios/:id', authMiddleware, async (req, res) => {
  try { await pool.execute('UPDATE usuarios SET ativo=0 WHERE id=?', [req.params.id]); res.json({ message: 'Usuário desativado' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PERMISSÕES DE USUÁRIOS ───────────────────────────────────────────────────

// Criar tabela de permissões se não existir (chamado no initDB)
async function initPermissoes() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS usuario_permissoes (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      modulo     VARCHAR(50) NOT NULL,
      nivel      ENUM('none','read','write') DEFAULT 'none',
      UNIQUE KEY uk_usuario_modulo (usuario_id, modulo),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
  `);
}

// GET /usuarios/:id/permissoes
app.get('/usuarios/:id/permissoes', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT modulo, nivel FROM usuario_permissoes WHERE usuario_id = ?',
      [req.params.id]
    );
    const result = {};
    rows.forEach(r => { result[r.modulo] = r.nivel; });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /usuarios/:id/permissoes
app.put('/usuarios/:id/permissoes', authMiddleware, async (req, res) => {
  const permissoes = req.body; // { embarques: 'write', tarefas: 'read', ... }
  try {
    for (const [modulo, nivel] of Object.entries(permissoes)) {
      await pool.execute(`
        INSERT INTO usuario_permissoes (usuario_id, modulo, nivel)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE nivel = VALUES(nivel)
      `, [req.params.id, modulo, nivel]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /usuarios/:id/dados — editar nome, email, cargo
app.put('/usuarios/:id/dados', authMiddleware, async (req, res) => {
  const { nome, email, cargo } = req.body;
  if (!nome || !email) return res.status(400).json({ message: 'nome e email são obrigatórios' });
  try {
    await pool.execute(
      'UPDATE usuarios SET nome=?, email=?, cargo=? WHERE id=?',
      [nome, email, cargo || 'Operador', req.params.id]
    );
    const [updated] = await pool.execute(
      'SELECT id, nome, email, cargo, ativo FROM usuarios WHERE id=?',
      [req.params.id]
    );
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── START: LOCAL ou VERCEL ───────────────────────────────────────────────────
// Inicializa o banco assim que o módulo é carregado
let dbReady = false;
initDB()
  .then(() => { dbReady = true; })
  .catch(err => console.error('❌ Erro ao inicializar DB:', err.message));

// Modo local: iniciar servidor HTTP
if (process.env.NODE_ENV !== 'production' || process.env.LOCAL_SERVER === 'true') {
  app.listen(PORT, () => console.log(`\n🚢  Vipe Transportes rodando em http://localhost:${PORT}\n`));
}

// Exportar para Vercel (serverless)
module.exports = app;
