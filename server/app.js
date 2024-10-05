const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

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

  // 먼저 연결을 확인합니다
  transporter.verify(function(error, success) {
    if (error) {
      console.error('Transporter verification error:', error);
      res.status(500).json({ error: 'Error verifying email transporter', details: error.message });
    } else {
      console.log("Server is ready to take our messages");
      // 연결이 확인되면 이메일을 보냅니다
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('EMAIL_PASS is set:', !!process.env.EMAIL_PASS);
});