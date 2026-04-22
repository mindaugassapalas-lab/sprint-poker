const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'gsp-shift4-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

const ADMIN_USERS = [
  { id: 'a1', username: 'admin', password: 'admin', name: 'Admin User', email: 'admin@shift4.com', avatar: 'AU' },
  { id: 'a2', username: 'tomas', password: 'tomas', name: 'Tomas Kavaliauskas', email: 'tomas@shift4.com', avatar: 'TK' },
  { id: 'a3', username: 'marta', password: 'marta', name: 'Marta Petrauskienė', email: 'marta@shift4.com', avatar: 'MP' },
];

const sessions = {};
const clients = {};

function broadcast(sessionId, message) {
  if (!clients[sessionId]) return;
  const data = JSON.stringify(message);
  clients[sessionId].forEach(c => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data); });
}

function getPublicSession(s) {
  return { id: s.id, name: s.name, host: s.host, hostId: s.hostId, stories: s.stories, currentIdx: s.currentIdx, votes: s.votes, accepted: s.accepted, revealed: s.revealed, participants: s.participants, settings: s.settings };
}

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = ADMIN_USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ error: 'Invalid credentials' });
  req.session.user = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, isAdmin: true };
  res.json({ success: true, user: req.session.user });
});

app.post('/auth/guest', (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) return res.json({ error: 'Enter your name' });
  const guest = { id: 'g_' + uuidv4().slice(0, 8), name: name.trim(), avatar: name.trim().slice(0, 2).toUpperCase(), isAdmin: false, isGuest: true };
  req.session.user = guest;
  res.json({ success: true, user: guest });
});

app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.user);
});

app.post('/api/session', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  const { name, stories, settings } = req.body;
  if (!name || !stories || !stories.length) return res.status(400).json({ error: 'Missing data' });
  const sessionId = uuidv4().slice(0, 8);
  const user = req.session.user;
  sessions[sessionId] = {
    id: sessionId, name, host: user.name, hostId: user.id,
    stories, currentIdx: 0, votes: {}, accepted: {}, revealed: {},
    participants: [], settings: settings || { showName: true, showDescription: true, showComments: true },
    comments: {}
  };
  clients[sessionId] = new Set();
  res.json({ sessionId });
});

app.get('/api/session/:id', (req, res) => {
  const s = sessions[req.params.id];
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(getPublicSession(s));
});

const DEMO_JIRA = {
  'PROJ-42': { key: 'PROJ-42', summary: 'Implement user authentication with OAuth 2.0', description: `## Overview\nImplement a secure OAuth 2.0 authentication flow for all internal tools used by Shift4 engineering teams.\n\n## Acceptance Criteria\n- Users can log in with their company Google account via Okta SSO\n- Sessions expire after 8 hours of inactivity\n- Failed login attempts are logged to Splunk\n- Users are redirected to the page they tried to access after login\n\n## Technical Notes\nUse Passport.js with the Google OAuth 2.0 strategy. Store sessions in Redis for scalability. Ensure CSRF protection is in place.\n\n## Out of Scope\n- Password reset flow (PROJ-48)\n- Two-factor authentication (PROJ-51)`, status: 'In Progress', assignee: 'Tomas K.', priority: 'High' },
  'PROJ-43': { key: 'PROJ-43', summary: 'Payment form redesign – mobile responsive', description: `## Overview\nRedesign the payment form to be fully responsive on all mobile devices.\n\n## Acceptance Criteria\n- Form works on screens 320px and above\n- All input fields are easily tappable on mobile\n- Card number formatting works on mobile keyboards\n- Error messages are visible and clear\n\n## Technical Notes\nUse CSS Grid with auto-fit columns. Test on iOS Safari and Chrome Android.`, status: 'To Do', assignee: 'Marta P.', priority: 'Medium' },
  'PROJ-44': { key: 'PROJ-44', summary: 'Email notification system for failed transactions', description: `## Overview\nBuild an automated email notification system that alerts relevant teams when transactions fail above a threshold.\n\n## Acceptance Criteria\n- Notifications sent within 60 seconds of threshold breach\n- Email includes transaction ID, error code, and timestamp\n- Configurable threshold per merchant\n- Notification rate limiting (max 1 per 15 min per merchant)\n\n## Technical Notes\nUse existing SendGrid integration. Add background job checking failure rates every 30 seconds.`, status: 'To Do', assignee: 'Unassigned', priority: 'High' },
  'PROJ-45': { key: 'PROJ-45', summary: 'Dark mode support across all dashboards', description: `## Overview\nAdd dark mode support to all internal dashboard pages.\n\n## Acceptance Criteria\n- Dark mode toggle in user preferences\n- Preference persists across sessions\n- All charts and graphs are readable in dark mode\n- Follows OS-level dark mode preference by default\n\n## Technical Notes\nUse CSS custom properties for theming. Avoid hardcoded colors.`, status: 'Backlog', assignee: 'Tomas K.', priority: 'Low' }
};

app.get('/api/jira/:key', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  const key = req.params.key.toUpperCase();
  res.json(DEMO_JIRA[key] || { key, summary: key, description: null, status: 'Unknown', assignee: 'Unassigned', priority: 'Medium' });
});

wss.on('connection', (ws) => {
  let sessionId = null, userInfo = null, clientEntry = null;

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      sessionId = msg.sessionId; userInfo = msg.user;
      const gs = sessions[sessionId];
      if (!gs) { ws.send(JSON.stringify({ type: 'error', message: 'Session not found' })); return; }
      if (!clients[sessionId]) clients[sessionId] = new Set();
      clientEntry = { ws, userId: userInfo.id, userName: userInfo.name };
      clients[sessionId].add(clientEntry);
      if (!gs.participants.find(p => p.id === userInfo.id)) {
        gs.participants.push({ id: userInfo.id, name: userInfo.name, avatar: userInfo.avatar, role: 'participant', isGuest: userInfo.isGuest || false });
      }
      ws.send(JSON.stringify({ type: 'state', session: getPublicSession(gs), you: userInfo }));
      broadcast(sessionId, { type: 'participant_joined', user: userInfo, participants: gs.participants });
    }

    if (msg.type === 'vote') {
      const gs = sessions[sessionId]; if (!gs) return;
      if (!gs.votes[gs.currentIdx]) gs.votes[gs.currentIdx] = {};
      gs.votes[gs.currentIdx][userInfo.name] = msg.value;
      broadcast(sessionId, { type: 'voted', userName: userInfo.name, storyIdx: gs.currentIdx, votes: gs.votes[gs.currentIdx] });
    }

    if (msg.type === 'reveal') {
      const gs = sessions[sessionId]; if (!gs || gs.hostId !== userInfo.id) return;
      gs.revealed[gs.currentIdx] = true;
      broadcast(sessionId, { type: 'revealed', storyIdx: gs.currentIdx, votes: gs.votes[gs.currentIdx] || {} });
    }

    if (msg.type === 'accept_sp') {
      const gs = sessions[sessionId]; if (!gs || gs.hostId !== userInfo.id) return;
      gs.accepted[gs.currentIdx] = msg.sp;
      broadcast(sessionId, { type: 'sp_accepted', storyIdx: gs.currentIdx, sp: msg.sp });
    }

    if (msg.type === 'navigate') {
      const gs = sessions[sessionId]; if (!gs || gs.hostId !== userInfo.id) return;
      const newIdx = Math.max(0, Math.min(gs.stories.length - 1, msg.idx));
      gs.currentIdx = newIdx;
      broadcast(sessionId, { type: 'navigated', idx: newIdx });
    }

    if (msg.type === 'set_role') {
      const gs = sessions[sessionId]; if (!gs) return;
      if (msg.userId !== userInfo.id && gs.hostId !== userInfo.id) return;
      const p = gs.participants.find(p => p.id === msg.userId);
      if (p) { p.role = msg.role; broadcast(sessionId, { type: 'role_changed', participants: gs.participants }); }
    }

    if (msg.type === 'comment') {
      const gs = sessions[sessionId]; if (!gs) return;
      if (!gs.comments[gs.currentIdx]) gs.comments[gs.currentIdx] = [];
      const comment = { author: userInfo.name, avatar: userInfo.avatar, text: msg.text, timestamp: new Date().toISOString() };
      gs.comments[gs.currentIdx].push(comment);
      broadcast(sessionId, { type: 'new_comment', storyIdx: gs.currentIdx, comment });
    }
  });

  ws.on('close', () => { if (sessionId && clients[sessionId] && clientEntry) clients[sessionId].delete(clientEntry); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Grooming Sprint Poker v3 running on port ${PORT}`));
