# Careers by OneQik — Backend API

## Tech stack
- **Runtime**: Node.js 18+ (Express.js)
- **Database**: MySQL 8 (Hostinger included)
- **Auth**: JWT (access + refresh tokens)
- **Hosting**: Hostinger Business/Cloud or VPS

---

## Hostinger deployment (step by step)

### Option A — Hostinger Business/Cloud Plan (recommended, easiest)
Supports Node.js natively with auto-build from GitHub.

1. Log in to hPanel → Websites → Add Website → **Node.js Apps**
2. Connect your GitHub repo containing this folder
3. Hostinger auto-detects Express.js — set:
   - **Build command**: `npm install`
   - **Start command**: `node src/server.js`
   - **Entry file**: `src/server.js`
4. In hPanel → Databases → Create a MySQL database + user
5. In hPanel → Node.js App → Environment Variables → paste all values from `.env.example`
6. Click Deploy — done.

### Option B — Hostinger VPS (more control, ~₹400/mo)
Full root access, run Node.js + PM2 for process management.

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (process manager — keeps app alive)
npm install -g pm2

# Clone your repo
git clone https://github.com/YOUR_REPO/careers-backend.git
cd careers-backend
npm install

# Copy .env.example → .env and fill in values
cp .env.example .env
nano .env

# Run migrations
node scripts/migrate.js

# Start with PM2
pm2 start src/server.js --name careers-api
pm2 save
pm2 startup  # auto-restart on reboot

# Point your domain: hPanel → DNS → A record → VPS IP
# Then set up Nginx reverse proxy:
sudo apt install nginx
sudo nano /etc/nginx/sites-available/careers
```

Nginx config:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/careers /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# Add SSL (free via Let's Encrypt)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

---

## API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register/candidate` | Register candidate |
| POST | `/api/auth/register/employer` | Register employer + company |
| POST | `/api/auth/login` | Login (returns JWT) |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/digilocker/initiate` | Start DigiLocker OAuth |
| GET | `/api/auth/digilocker/callback` | DigiLocker callback |

### Jobs
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | Search jobs (candidate) |
| GET | `/api/jobs/form-meta?department=Sales` | Progressive dropdown data |
| POST | `/api/jobs` | Create job posting (employer) |
| GET | `/api/jobs/employer` | Employer's all jobs (no time limit) |
| GET | `/api/jobs/:id` | Job detail + pre-screen questions |
| PATCH | `/api/jobs/:id` | Update job (close, pause, etc.) |
| POST | `/api/jobs/:id/apply` | Apply with pre-screen answers |
| GET | `/api/jobs/my/applications` | Candidate's application history |
| GET | `/api/jobs/:id/applications` | Employer views pipeline |
| PATCH | `/api/jobs/applications/:appId` | Update application status (TAT tracked) |
| GET | `/api/jobs/applications/:appId/history` | Status timeline |

### Candidates
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/candidates/me` | Full candidate profile |
| PATCH | `/api/candidates/me` | Update profile |
| POST | `/api/candidates/me/experience` | Add work experience |
| POST | `/api/candidates/me/experience/:id/achievement` | Add achievement |
| POST | `/api/candidates/me/experience/:id/request-verification` | Request employer verification |
| GET | `/api/candidates/:id` | Public profile (employer view) |
| GET | `/api/candidates/search` | Employer searches candidate DB |

### Companies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/companies/:slug` | Company intelligence page |
| PATCH | `/api/companies/me` | Update company profile (with history) |
| POST | `/api/companies/me/career-ladder` | Add domain career ladder |
| POST | `/api/companies/me/appraisal` | Add appraisal data |
| POST | `/api/companies/:id/review` | Submit anonymous review |

---

## Career Score calculation

Score = 300 (base) + pillar points, capped at 900.

| Pillar | Weight | Max pts |
|--------|--------|---------|
| Skill Impact | 30% | 270 |
| Credibility & Accountability | 25% | 225 |
| Engagement Quality | 20% | 180 |
| Values & Growth Mindset | 15% | 135 |
| Identity Integrity | 10% | 90 |

Identity gate: unverified Aadhaar → score capped at 500.

Recalculates automatically on:
- Course completion
- Offer accepted/declined
- New employer rating received
- DigiLocker linked
- Profile updated

---

## About PageInex AI comparison

Yes — Careers can have the same kind of dynamic, AI-powered data as PageInex AI.
Hostinger Business/Cloud handles Node.js natively with no cold starts, no usage fees.
For real-time features (live notifications, application status push), the VPS option
with WebSockets is the better long-term path.

Both options sit on your existing Hostinger account/domain.
