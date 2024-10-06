import React from 'react';
import { Link } from 'react-router-dom';
import './Main.css';

function Main() {
  return (
    <main className="main">
      <section className="hero"  style={{ backgroundImage: `url(${process.env.REACT_APP_HERO_IMAGE})` }}>
        <div className="hero-content">
          <h1><span className="highlight">작은별612</span>는</h1>
          <p className="subtitle">이미 우리곁에 다가온 Ai가 3D 캐릭터를 통해</p>
          <p className="subtitle">더욱 가까워질 미래를 준비하고 있습니다.</p>
        </div>
      </section>
      <section className="content-block">
        <img src={process.env.PUBLIC_URL + "/images/team.jpg"} alt="Our Team" />
        <div className="text-content">
          <h2>Our Team</h2>
          <p>다양한 배경과 경험을 모아 AI+3D 언어모델을 통한 개발을 위한 최적의 인력이 모였습니다.</p>
        </div>
      </section>
      <section className="content-block vision-block">
      <div className="text-content">
        <h2>Our Vision</h2>
        <p>AI의 혁신적인 발전만큼 음성과 텍스트가 아니라 3D캐릭터를 통한 구현합니다.</p>
      </div>
      <img src={process.env.PUBLIC_URL + "/images/vision.jpg"} alt="Our Vision" />
    </section>
      <section className="content-block product-block">
        <h2>Our Products</h2>
        <div className="product-cards">
          {[
            {
              name: 'AI 영어친구',
              description: '실시간 대화와 피드백, 그룹 관리/리포트 통한 맞춤형 영어 학습 경험을 제공합니다.'
            },
            {
              name: 'AI 언어모델',
              description: '영어/한국어 음성 학습 지원과 번역으로 언어 장벽을 허물어냅니다.'
            },
            {
              name: 'AI+3D',
              description: '몰입감 있는 3D 환경에서 AI와 상호작용하며 학습합니다.'
            }
          ].map((product, index) => (
            <div key={index} className="product-card">
              <h3>{product.name}</h3>
              <p>{product.description}</p>
              <Link to="/product" className="btn">Learn More</Link>
            </div>
          ))}
        </div>
      </section>
      <section className="content-block contact-us">
        <img src={process.env.PUBLIC_URL + "/images/contact.jpg"} alt="Contact Us" />
        <div className="text-content">
          <h2>Contact Us</h2>
          <p>궁금한 점이 있으신가요? 언제든지 문의해주세요.</p>
          <Link to="/contact" className="btn">문의하기</Link>
        </div>
      </section>
    </main>
  );
}

export default Main;