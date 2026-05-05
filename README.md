# TaskFlow — Team Task Manager

A full-stack team task manager with JWT authentication and role-based access control.

## 🔗 Live Demo
<!-- Replace with your Railway URL after deploying -->
https://YOUR-APP.up.railway.app

## ✨ Features
- **Authentication** — Signup/Login with JWT tokens (7-day expiry)
- **Projects** — Create, edit, delete projects
- **Team Management** — Invite members, assign Admin or Member roles
- **Tasks** — Create, assign, filter, and track tasks with status & priority
- **Dashboard** — Overview of your tasks, overdue items, project progress
- **Kanban Board** — Visual board with To Do / In Progress / Review / Done columns
- **Role-Based Access** — Admins manage members and all tasks; Members manage their own
- **Overdue Tracking** — Highlights tasks past their due date

## 🛠 Tech Stack
| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | SQLite via sql.js (zero-config, file-persisted) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Frontend | Vanilla JS SPA (no build step) |

## 📁 Folder Structure
```
taskflow/
├── server.js          # Express server + all API routes
├── public/
│   └── index.html     # Complete frontend (single file SPA)
├── package.json
├── .gitignore
└── README.md
```

## 🚀 Run Locally
```bash
git clone https://github.com/YOUR_USERNAME/taskflow.git
cd taskflow
npm install
node server.js
# Open http://localhost:3000
```

## 🌐 Deploy to Railway
1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variable: `JWT_SECRET` = any long random string
4. Click Generate Domain → get your live URL

## 📡 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/signup | Register new user |
| POST | /api/auth/login | Login, returns JWT |
| GET | /api/auth/me | Get current user |

### Projects
| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| GET | /api/projects | ✅ | Any |
| POST | /api/projects | ✅ | Any |
| GET | /api/projects/:id | ✅ | Member+ |
| PUT | /api/projects/:id | ✅ | Admin |
| DELETE | /api/projects/:id | ✅ | Owner |

### Tasks
| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| GET | /api/projects/:id/tasks | ✅ | Member+ |
| POST | /api/projects/:id/tasks | ✅ | Member+ |
| PUT | /api/projects/:id/tasks/:tid | ✅ | Member (own) / Admin (all) |
| DELETE | /api/projects/:id/tasks/:tid | ✅ | Creator / Admin |

### Members
| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| GET | /api/projects/:id/members | ✅ | Member+ |
| POST | /api/projects/:id/members | ✅ | Admin |
| PUT | /api/projects/:id/members/:uid | ✅ | Admin |
| DELETE | /api/projects/:id/members/:uid | ✅ | Admin |

## 🔐 Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| JWT_SECRET | Yes | Secret key for signing JWTs |
| PORT | No | Port (Railway sets this automatically) |
| NODE_ENV | No | Set to `production` on Railway |
