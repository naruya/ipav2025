const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());  // 全てのエンドポイントで CORS を許可
app.use(express.json());

const sessions = {};
// sessions[sessionId] = { offer: {...}, answer: {...} }

app.post('/signaling/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { type, sdp, candidate } = req.body;
  console.log('current sessions:', Object.keys(sessions));

  if (!sessions[sessionId]) {
    console.log('create session', sessionId);
    sessions[sessionId] = {};
  }
  if (!sessions[sessionId][type]) {
    sessions[sessionId][type] = {};
  }
  if (sdp) {
    sessions[sessionId][type].sdp = sdp;
  }
  if (candidate) {
    sessions[sessionId][type].candidate = candidate;
  }
  console.log('set session', sessionId, type);

  res.json({ status: 'ok' });
});

app.get('/signaling/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { type } = req.query;
  console.log('current sessions:', Object.keys(sessions));

  const session = sessions[sessionId];

  if (!session || !session[type]) {
    return res.status(404).send('Not found');
  }

  res.json(session[type]);
});

app.delete('/signaling/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  console.log('delete session', sessionId);
  if (sessions[sessionId]) {
    delete sessions[sessionId];
  }
  console.log('current sessions:', Object.keys(sessions));
  return res.json({status: 'deleted'});
});

app.listen(3000, () => {
  console.log('Signaling server running on port 3000');
});
