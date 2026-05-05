const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'taskflow_super_secret_2024';
const PORT = process.env.PORT || 3000;

// ─── DATABASE SETUP (sql.js with file persistence) ─────────────────────────
const initSqlJs = require('sql.js');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'taskflow.db');

let db;

async function initDB() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Save DB helper
  global.saveDB = () => {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  };

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      owner_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER,
      created_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id),
      FOREIGN KEY(assigned_to) REFERENCES users(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
  `);
  
  saveDB();
  console.log('✅ Database initialized');
}

// ─── DB QUERY HELPERS ───────────────────────────────────────────────────────
function dbAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const results = [];
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (e) {
    throw e;
  }
}

function dbGet(sql, params = []) {
  const results = dbAll(sql, params);
  return results[0] || null;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDB();
  return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
}

// ─── AUTH MIDDLEWARE ────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function projectAdminMiddleware(req, res, next) {
  const { projectId } = req.params;
  const member = dbGet(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, req.user.id]
  );
  if (!member || member.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.projectRole = member.role;
  next();
}

function projectMemberMiddleware(req, res, next) {
  const { projectId } = req.params;
  const member = dbGet(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, req.user.id]
  );
  if (!member) return res.status(403).json({ error: 'Not a project member' });
  req.projectRole = member.role;
  next();
}

// ─── AUTH ROUTES ────────────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const id = dbRun('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashed]);
    const token = jwt.sign({ id, name, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, name, email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'All fields required' });

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = dbGet('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.user.id]);
  res.json(user);
});

// ─── USER ROUTES ────────────────────────────────────────────────────────────
app.get('/api/users/search', authMiddleware, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const users = dbAll(
    'SELECT id, name, email FROM users WHERE (name LIKE ? OR email LIKE ?) AND id != ? LIMIT 10',
    [`%${q}%`, `%${q}%`, req.user.id]
  );
  res.json(users);
});

// ─── PROJECT ROUTES ─────────────────────────────────────────────────────────
app.get('/api/projects', authMiddleware, (req, res) => {
  const projects = dbAll(`
    SELECT p.*, pm.role, u.name as owner_name,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') as done_count
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    JOIN users u ON p.owner_id = u.id
    WHERE pm.user_id = ?
    ORDER BY p.created_at DESC
  `, [req.user.id]);
  res.json(projects);
});

app.post('/api/projects', authMiddleware, (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name required' });

    const id = dbRun('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)',
      [name, description || '', req.user.id]);
    dbRun('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
      [id, req.user.id, 'admin']);

    res.json({ id, name, description, owner_id: req.user.id, role: 'admin' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:projectId', authMiddleware, projectMemberMiddleware, (req, res) => {
  const project = dbGet(`
    SELECT p.*, u.name as owner_name, pm.role
    FROM projects p
    JOIN users u ON p.owner_id = u.id
    JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
    WHERE p.id = ?
  `, [req.user.id, req.params.projectId]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.put('/api/projects/:projectId', authMiddleware, projectAdminMiddleware, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  dbRun('UPDATE projects SET name = ?, description = ? WHERE id = ?',
    [name, description || '', req.params.projectId]);
  res.json({ success: true });
});

app.delete('/api/projects/:projectId', authMiddleware, projectAdminMiddleware, (req, res) => {
  const { projectId } = req.params;
  // Only owner can delete
  const project = dbGet('SELECT * FROM projects WHERE id = ? AND owner_id = ?', [projectId, req.user.id]);
  if (!project) return res.status(403).json({ error: 'Only project owner can delete' });
  
  dbRun('DELETE FROM tasks WHERE project_id = ?', [projectId]);
  dbRun('DELETE FROM project_members WHERE project_id = ?', [projectId]);
  dbRun('DELETE FROM projects WHERE id = ?', [projectId]);
  res.json({ success: true });
});

// ─── MEMBER ROUTES ──────────────────────────────────────────────────────────
app.get('/api/projects/:projectId/members', authMiddleware, projectMemberMiddleware, (req, res) => {
  const members = dbAll(`
    SELECT u.id, u.name, u.email, pm.role, pm.joined_at
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
    ORDER BY pm.role DESC, u.name
  `, [req.params.projectId]);
  res.json(members);
});

app.post('/api/projects/:projectId/members', authMiddleware, projectAdminMiddleware, (req, res) => {
  try {
    const { userId, role = 'member' } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const user = dbGet('SELECT id, name, email FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existing = dbGet('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
      [req.params.projectId, userId]);
    if (existing) return res.status(400).json({ error: 'User already a member' });

    dbRun('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)',
      [req.params.projectId, userId, role]);
    res.json({ success: true, user, role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:projectId/members/:userId', authMiddleware, projectAdminMiddleware, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  
  const project = dbGet('SELECT owner_id FROM projects WHERE id = ?', [req.params.projectId]);
  if (parseInt(req.params.userId) === project.owner_id && role !== 'admin')
    return res.status(400).json({ error: 'Cannot demote project owner' });

  dbRun('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?',
    [role, req.params.projectId, req.params.userId]);
  res.json({ success: true });
});

app.delete('/api/projects/:projectId/members/:userId', authMiddleware, projectAdminMiddleware, (req, res) => {
  const project = dbGet('SELECT owner_id FROM projects WHERE id = ?', [req.params.projectId]);
  if (parseInt(req.params.userId) === project.owner_id)
    return res.status(400).json({ error: 'Cannot remove project owner' });

  dbRun('DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
    [req.params.projectId, req.params.userId]);
  // Unassign tasks
  dbRun('UPDATE tasks SET assigned_to = NULL WHERE project_id = ? AND assigned_to = ?',
    [req.params.projectId, req.params.userId]);
  res.json({ success: true });
});

// ─── TASK ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/projects/:projectId/tasks', authMiddleware, projectMemberMiddleware, (req, res) => {
  const { status, priority, assignedTo } = req.query;
  let sql = `
    SELECT t.*, 
      u1.name as assigned_name, u1.email as assigned_email,
      u2.name as created_by_name
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    WHERE t.project_id = ?
  `;
  const params = [req.params.projectId];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  if (assignedTo) { sql += ' AND t.assigned_to = ?'; params.push(assignedTo); }
  sql += ' ORDER BY t.created_at DESC';
  res.json(dbAll(sql, params));
});

app.post('/api/projects/:projectId/tasks', authMiddleware, projectMemberMiddleware, (req, res) => {
  try {
    const { title, description, assignedTo, priority = 'medium', dueDate, status = 'todo' } = req.body;
    if (!title) return res.status(400).json({ error: 'Task title required' });
    if (!['todo', 'in_progress', 'review', 'done'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    if (!['low', 'medium', 'high', 'urgent'].includes(priority))
      return res.status(400).json({ error: 'Invalid priority' });

    if (assignedTo) {
      const member = dbGet('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
        [req.params.projectId, assignedTo]);
      if (!member) return res.status(400).json({ error: 'Assignee must be a project member' });
    }

    const id = dbRun(`
      INSERT INTO tasks (project_id, title, description, assigned_to, created_by, status, priority, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [req.params.projectId, title, description || '', assignedTo || null, req.user.id, status, priority, dueDate || null]);

    res.json({ id, title, status, priority });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:projectId/tasks/:taskId', authMiddleware, projectMemberMiddleware, (req, res) => {
  try {
    const { title, description, assignedTo, status, priority, dueDate } = req.body;
    const task = dbGet('SELECT * FROM tasks WHERE id = ? AND project_id = ?',
      [req.params.taskId, req.params.projectId]);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Members can only update status of their tasks; admins can update everything
    if (req.projectRole === 'member' && task.created_by !== req.user.id && task.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'Can only update your own tasks' });
    }

    if (assignedTo) {
      const member = dbGet('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
        [req.params.projectId, assignedTo]);
      if (!member) return res.status(400).json({ error: 'Assignee must be a project member' });
    }

    dbRun(`UPDATE tasks SET 
      title = ?, description = ?, assigned_to = ?, status = ?, priority = ?, due_date = ?,
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        title || task.title,
        description !== undefined ? description : task.description,
        assignedTo !== undefined ? (assignedTo || null) : task.assigned_to,
        status || task.status,
        priority || task.priority,
        dueDate !== undefined ? (dueDate || null) : task.due_date,
        req.params.taskId
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:projectId/tasks/:taskId', authMiddleware, projectMemberMiddleware, (req, res) => {
  const task = dbGet('SELECT * FROM tasks WHERE id = ? AND project_id = ?',
    [req.params.taskId, req.params.projectId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (req.projectRole === 'member' && task.created_by !== req.user.id)
    return res.status(403).json({ error: 'Only task creator or admin can delete' });

  dbRun('DELETE FROM tasks WHERE id = ?', [req.params.taskId]);
  res.json({ success: true });
});

// ─── DASHBOARD ROUTE ─────────────────────────────────────────────────────────
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  const myTasks = dbAll(`
    SELECT t.*, p.name as project_name, u.name as assigned_name
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.assigned_to = ? AND t.status != 'done'
    ORDER BY t.due_date ASC, t.priority DESC
    LIMIT 10
  `, [req.user.id, req.user.id]);

  const overdue = dbAll(`
    SELECT t.*, p.name as project_name
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
    WHERE t.due_date < ? AND t.status != 'done' AND t.due_date IS NOT NULL
    ORDER BY t.due_date ASC
  `, [req.user.id, today]);

  const stats = dbGet(`
    SELECT 
      COUNT(DISTINCT p.id) as total_projects,
      COUNT(DISTINCT t.id) as total_tasks,
      SUM(CASE WHEN t.assigned_to = ? AND t.status != 'done' THEN 1 ELSE 0 END) as my_open_tasks,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed_tasks
    FROM project_members pm
    JOIN projects p ON pm.project_id = p.id
    LEFT JOIN tasks t ON p.id = t.project_id
    WHERE pm.user_id = ?
  `, [req.user.id, req.user.id]);

  const recentProjects = dbAll(`
    SELECT p.*, pm.role,
      COUNT(DISTINCT t.id) as task_count,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_count
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
    LEFT JOIN tasks t ON p.id = t.project_id
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT 5
  `, [req.user.id]);

  res.json({ myTasks, overdue, stats, recentProjects });
});

// Serve frontend for all non-API routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ───────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 TaskFlow running on port ${PORT}`));
}).catch(console.error);
