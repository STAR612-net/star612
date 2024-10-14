import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from './PageHeader';
import './Product.css';

// 텍스트를 마침표 기준으로 줄바꿈하는 함수
const formatText = (text) => {
  return text.split('. ').map((sentence, index, array) => (
    <React.Fragment key={index}>
      {sentence}{index < array.length - 1 ? '.' : ''}
      {index < array.length - 1 && <br />}
    </React.Fragment>
  ));
};

function Product() {
  return (
    <div className="product-page">
      <PageHeader 
        title="Our Products" 
        subtitle="3D로 시각화된 AI와 언어를 배우고 여행에선 동반자가 되는 세상" 
        backgroundImage={process.env.PUBLIC_URL + "/images/product-bg.jpg"}
      />
      <div className="product-container">
        <h2 className="product-intro">
          <span className="highlight">AI</span>와 <span className="highlight">3D 기술</span>로 혁신적인 언어 학습과 에이전트 경험을 제공합니다
        </h2>
        <div className="product-separator"></div>
        <p className="product-description">
          {formatText("Star612는 최첨단 AI와 3D 기술을 결합하여 혁신적인 언어 학습/통역 솔루션을 제공합니다. 우리의 제품은 학습자들에게 몰입감 있고 효과적인 언어 학습 경험을 선사합니다.")}
        </p>
        
        <div className="product-highlight-section">
          <div className="product-highlight-box">
            <img src={process.env.PUBLIC_URL + "/images/ai01.png"} alt="AI 대화모델" />
            <h3>AI 대화모델</h3>
          </div>
          <div className="product-highlight-box">
            <img src={process.env.PUBLIC_URL + "/images/ai02.png"} alt="3D 캐릭터 에이전트" />
            <h3>3D 캐릭터 에이전트</h3>
          </div>
        </div>

        <div className="product-full-width-section">
          <h3>AI 분석툴 + 성장형 캐릭터</h3>
          <div className="product-section">
            <div className="product-image">
              <img src={process.env.PUBLIC_URL + "/images/ai03.png"} alt="AI 분석툴 + 성장형 캐릭터" />
            </div>
            <div className="product-content">
              <p>
                {formatText("AI 분석 툴을 통해 학습자의 진행 상황을 정확히 파악하고, 이에 따라 성장하는 3D 캐릭터로 학습 동기를 부여합니다. 개인화된 학습 경험과 시각적 피드백으로 효과적인 언어 습득을 지원합니다.")}
              </p>
              <Link to="/avatar-details" className="product-link-wrapper">
                <button className="product-link active">자세히 보기</button>
              </Link>
            </div>
          </div>
        </div>

        <div className="product-section">
          <div className="product-image">
            <img src={process.env.PUBLIC_URL + "/images/icon01.png"} alt="Icon 1" />
          </div>
          <div className="product-content">
            <h3>AI 영어친구[Beta]</h3>
            <p>
              {formatText("학교/기업 등에 AI 튜터가 학습자의 수준과 목표에 맞춘 맞춤형 학습을 제공합니다. 실시간 피드백과 교정 및 그룹 리포터 제공으로 효과적인 언어 습득을 돕습니다.")}
            </p>
            <Link to="ai/" className="product-link-wrapper">
              <button className="product-link active">바로가기</button>
            </Link>
          </div>
        </div>

        <div className="product-section">
          <div className="product-image">
            <img src={process.env.PUBLIC_URL + "/images/icon02.png"} alt="Icon 2" />
          </div>
          <div className="product-content">
            <h3>3D캐릭터 언어모델</h3>
            <p>
              {formatText("몰입감 있는 3D 가상 세계에서 다양한 상황별 언어 학습을 경험하세요. 실제 생활과 유사한 환경에서 자연스럽게 언어를 습득할 수 있습니다.")}
            </p>
            <button className="product-link inactive">준비중</button>
          </div>
        </div>

        <div className="product-section">
          <div className="product-image">
            <img src={process.env.PUBLIC_URL + "/images/icon03.png"} alt="Icon 3" />
          </div>
          <div className="product-content">
            <h3>학습/여행 AI에이전트</h3>
            <p>
              {formatText("다른 나라를 방문하는 한국인, 방문 여행객 실시간 학습 및 통역을 제공하는 AI 동반자입니다. 언어학습의 두려움 극복 후 세계 곳곳을 탐험하세요.")}
            </p>
            <span className="product-link inactive">준비중</span>
          </div>
        </div>

        <div className="product-section">
          <div className="product-image">
            <img src={process.env.PUBLIC_URL + "/images/icon04.png"} alt="Icon 4" />
          </div>
          <div className="product-content">
            <h3>성장하는 3D AI 캐릭터</h3>
            <p>
              {formatText("사용자의 학습 진도와 연동되어 성장하는 3D 캐릭터를 통해 학습의 몰입감과 친밀도를 높입니다. 캐릭터의 성장이 곧 사용자의 언어 능력 향상을 시각적으로 보여주어 지속적인 학습 동기를 부여합니다.")}
            </p>
            <span className="product-link inactive">준비중</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Product;