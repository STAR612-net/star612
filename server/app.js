const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws'); // WebSocket 모듈 추가
const helmet = require('helmet'); // Helmet 모듈 추가
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;
const isHttps = process.env.HTTPS === 'true';

// HTTPS 사용 시 필요한 인증서 파일 경로
const httpsOptions = isHttps ? {
  key: fs.readFileSync(process.env.SSL_KEY_PATH),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH)
} : null;

// HTTP 또는 HTTPS 서버 생성
const server = isHttps ? https.createServer(httpsOptions, app) : http.createServer(app);

// WebSocket 서버 설정
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  ws.on('message', (message) => {
    console.log('Received:', message);
  });
  ws.send('Welcome to the WebSocket server!');
});

// Helmet을 사용해 CSP 설정 추가
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'", 'https:', 'data:', "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", 'wss://star612.net:3000'], // WebSocket 연결 허용
    },
  })
);

// 허용할 호스트 목록
const allowedHosts = ['localhost', 'star612.net', 'www.star612.net'];

// 호스트 확인 미들웨어
app.use((req, res, next) => {
  const host = req.get('host');
  if (allowedHosts.includes(host)) {
    next();
  } else {
    res.status(403).send('Invalid Host header');
  }
});

// CORS 및 미들웨어 설정
const cors = require('cors');
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client/build')));

// 이메일 전송을 위한 transporter 설정
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// API 라우트
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from server!' });
});

// 이메일 전송 API
app.post('/api/send-email', (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'star612.net@gmail.com', // 받는 사람 이메일 주소
    subject: `New contact form submission: ${subject}`,
    text: `
      Name: ${name}
      Email: ${email}
      Phone: ${phone}
      Subject: ${subject}
      Message: ${message}
    `
  };

  transporter.verify(function(error, success) {
    if (error) {
      console.error('Transporter verification error:', error);
      res.status(500).json({ error: 'Error verifying email transporter', details: error.message });
    } else {
      console.log("Server is ready to take our messages");
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error('Error sending email:', error);
          res.status(500).json({ error: 'Error sending email', details: error.message });
        } else {
          console.log('Email sent:', info.response);
          res.status(200).json({ message: 'Email sent successfully' });
        }
      });
    }
  });
});

// 모든 요청을 React app으로 전달 (프로덕션 환경에서 사용)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

server.listen(port, () => {
  console.log(`Server running at ${isHttps ? 'https' : 'http'}://localhost:${port}`);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('EMAIL_PASS is set:', !!process.env.EMAIL_PASS);
});
