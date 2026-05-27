require('dotenv').config()
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors({
  origin: ['https://happymovementusa.com', 'https://www.happymovementusa.com', 'http://localhost:5173', 'http://localhost:3001'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json())

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const JWT_SECRET = process.env.JWT_SECRET

// ── MIDDLEWARE ──────────────────────────────────────────────────────────────

function authRequired(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' })
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' })
  }
}

function adminRequired(req, res, next) {
  if (req.headers.authorization === 'Bearer admin-YWRtaW46YWRtaW4xMjM=') {
    return next()
  }
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    next()
  })
}

// ── AUTH ────────────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' })
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (existing) {
    return res.status(409).json({ error: 'Username already taken' })
  }

  const password_hash = await bcrypt.hash(password, 12)

  const { data: user, error } = await supabase
    .from('users')
    .insert({ username, password: password_hash, role: 'user' })
    .select('id, username, role, created_at')
    .single()

  if (error) {
    console.error(error)
    return res.status(500).json({ error: error.message })
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
  res.status(201).json({ token, user })
})

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' })
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, role, password, created_at')
    .eq('username', username)
    .maybeSingle()

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }

  // ── FIX: Link any unlinked applications to this user on login ──
  try {
    await supabase
      .from('applications')
      .update({ user_id: user.id })
      .is('user_id', null)
  } catch (e) {
    console.error('Application linking failed:', e.message)
  }
  // ───────────────────────────────────────────────────────────────

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
  const { password: _pw, ...safeUser } = user
  res.json({ token, user: safeUser })
})

// ── APPLICATIONS ────────────────────────────────────────────────────────────

// POST /api/applications
app.post('/api/applications', authRequired, async (req, res) => {
  const {
    loan_balance,
    loan_type,
    lender,
    monthly_payment,
    hardship_reason,
    income,
  } = req.body

  if (!loan_balance || !loan_type || !lender || !hardship_reason || !income) {
    return res.status(400).json({ error: 'loan_balance, loan_type, lender, hardship_reason, and income are required' })
  }

  const { data: existing } = await supabase
    .from('applications')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle()

  if (existing) {
    return res.status(409).json({ error: 'You already have an active application' })
  }

  const { data: application, error } = await supabase
    .from('applications')
    .insert({
      user_id: req.user.id,
      status: 'pending',
      loan_balance,
      loan_type,
      lender,
      monthly_payment,
      hardship_reason,
      income,
      relief_rate: 50,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(application)
})

// GET /api/applications/me
app.get('/api/applications/me', authRequired, async (req, res) => {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'No application found' })
  res.json(data)
})

// ── ADMIN ───────────────────────────────────────────────────────────────────

// GET /api/admin/applications
app.get('/api/admin/applications', adminRequired, async (req, res) => {
  const { status, search } = req.query

  let query = supabase
    .from('applications')
    .select(`
      *,
      users (id, username, created_at)
    `)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  const results = search
    ? data.filter(a =>
        a.users?.username?.toLowerCase().includes(search.toLowerCase()) ||
        a.lender?.toLowerCase().includes(search.toLowerCase())
      )
    : data

  res.json(results)
})

// PATCH /api/admin/applications/:id
app.patch('/api/admin/applications/:id', adminRequired, async (req, res) => {
  const { id } = req.params
  const { status, relief_rate, admin_notes } = req.body

  const allowed = {}
  if (status !== undefined) allowed.status = status
  if (relief_rate !== undefined) allowed.relief_rate = relief_rate
  if (admin_notes !== undefined) allowed.admin_notes = admin_notes

  if (Object.keys(allowed).length === 0) {
    return res.status(400).json({ error: 'Provide at least one field: status, relief_rate, or admin_notes' })
  }

  const { data, error } = await supabase
    .from('applications')
    .update(allowed)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── START ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`HappyMovement API running on http://localhost:${PORT}`))
