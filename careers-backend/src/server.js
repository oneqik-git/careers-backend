require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { testConnection } = require('../config/database');
const { checkTATBreaches } = require('./routes/jobs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(','),
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { success: false, message: 'Too many requests, please slow down' },
  standardHeaders: true,
});
app.use('/api/', limiter);

// ── PARSING ───────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV, ts: new Date().toISOString() });
});

// ── ROUTES ────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const { router: jobRoutes } = require('./routes/jobs');
const candidateRoutes = require('./routes/candidates');
const companyRoutes   = require('./routes/companies');

app.use('/api/auth',       authRoutes);
app.use('/api/jobs',       jobRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/companies',  companyRoutes);

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── ERROR HANDLER ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ── CRON: TAT breach check every 30 mins ─────────────────────────
setInterval(checkTATBreaches, 30 * 60 * 1000);

// ── START ─────────────────────────────────────────────────────────
async function start() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`\n🚀 Careers by OneQik API`);
    console.log(`   Port     : ${PORT}`);
    console.log(`   Env      : ${process.env.NODE_ENV}`);
    console.log(`   DB       : ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);
  });
}

start().catch(console.error);

module.exports = app;
