import React, { useState } from 'react';
import PageHeader from './PageHeader';
import './Contact.css';

function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: ''
  });
  const [submitStatus, setSubmitStatus] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitStatus('sending');
    try {
        const response = await fetch('/api/send-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(formData),
        });
        const data = await response.json();
        if (response.ok) {
          setSubmitStatus('success');
          setFormData({ name: '', email: '', phone: '', subject: '', message: '' });
        } else {
          console.error('Server error:', data.error);
          setSubmitStatus('error');
        }
      } catch (error) {
        console.error('Fetch error:', error);
        setSubmitStatus('error');
      }
  };

  return (
    <div className="contact-page">
      <PageHeader 
        title="Contact Us" 
        subtitle="플랫폼을 넘어 Ai 3D 캐릭터가 만들 미래가 궁금하다면" 
        backgroundImage="/images/contact-bg.jpg"
      />
      <div className="contact-container">
        <div className="contact-info">
          <h2>Contact Us</h2>
          <p className="sub-text">상세한 설명과 협업을 원할 경우 언제든 문의 주세요.</p>
        </div>
        <div className="contact-form">
          <form onSubmit={handleSubmit}>
            <input type="text" name="name" placeholder="이름 (기업명)" onChange={handleChange} value={formData.name} required />
            <input type="email" name="email" placeholder="이메일" onChange={handleChange} value={formData.email} required />
            <input type="tel" name="phone" placeholder="연락처" onChange={handleChange} value={formData.phone} required />
            <input type="text" name="subject" placeholder="제목" onChange={handleChange} value={formData.subject} required />
            <textarea name="message" placeholder="내용" onChange={handleChange} value={formData.message} required></textarea>
            <button type="submit" disabled={submitStatus === 'sending'}>
              {submitStatus === 'sending' ? '전송 중...' : '전송'}
            </button>
          </form>
          {submitStatus === 'success' && <p className="success-message">메시지가 성공적으로 전송되었습니다.</p>}
          {submitStatus === 'error' && <p className="error-message">메시지 전송에 실패했습니다. 다시 시도해 주세요.</p>}
        </div>
      </div>
    </div>
  );
}

export default Contact;