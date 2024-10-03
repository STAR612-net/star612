import React from 'react';
import PageHeader from './PageHeader';
import './Vision.css';

// 텍스트를 마침표 기준으로 줄바꿈하는 함수
const formatText = (text) => {
  return text.split('. ').map((sentence, index, array) => (
    <React.Fragment key={index}>
      {sentence}{index < array.length - 1 ? '.' : ''}
      {index < array.length - 1 && <br />}
    </React.Fragment>
  ));
};

function Vision() {
  return (
    <div className="vision-page">
      <PageHeader 
        title="Our Vision" 
        subtitle="음성과 텍스트가 아니라 3D 캐릭터를 통해 현실과 가상의 경계를 넘다." 
        backgroundImage={process.env.PUBLIC_URL + "/images/vision-bg.jpg"}
      />
      <div className="vision-container">
        <h2 className="vision-intro">
          <span className="highlight">AI</span>와 <span className="highlight">3D 기술</span>로 언어 학습의 새로운 지평을 열다
        </h2>
        <div className="vision-separator"></div>
        <p className="vision-description">
          {formatText("Star612는 AI와 3D 기술을 결합하여 언어 학습의 혁신을 추구합니다. 우리의 비전은 학습자들에게 몰입감 있고 효과적인 언어 학습 경험을 제공하는 것입니다.")}
        </p>
        
        <div className="vision-section">
          <div className="vision-image">
            <img src={process.env.PUBLIC_URL + "/images/innovative-ai.jpg"} alt="혁신적인 Ai 경험" />
          </div>
          <div className="vision-content">
            <div className="vision-title">
              <img src={process.env.PUBLIC_URL + "/images/icons8-electronics-52.png"} alt="아이콘" className="vision-icon" />
              <h3>혁신적인 Ai 동행 경험</h3>
            </div>
            <p>
              {formatText("3D 캐릭터와 AI의 결합으로 학습자들에게 실제와 같은 대화 환경을 제공합니다. 이를 통해 언어 학습의 효율성과 재미를 동시에 높입니다.")}
            </p>
          </div>
        </div>

        <div className="vision-section">
          <div className="vision-image">
            <img src={process.env.PUBLIC_URL + "/images/personalized-learning.jpg"} alt="개인화된 학습 여정" />
          </div>
          <div className="vision-content">
            <div className="vision-title">
              <img src={process.env.PUBLIC_URL + "/images/icons8-electronics-52.png"} alt="아이콘" className="vision-icon" />
              <h3>개인화된 학습 여정</h3>
            </div>
            <p>
              {formatText("AI 기술을 활용하여 각 학습자의 수준과 목표에 맞는 맞춤형 학습 경로를 제공합니다. 이를 통해 모든 학습자가 최적의 속도로 언어 능력을 향상시킬 수 있습니다.")}
            </p>
          </div>
        </div>

        <div className="vision-section">
          <div className="vision-image">
            <img src={process.env.PUBLIC_URL + "/images/global-communication.jpg"} alt="글로벌 커뮤니케이션의 미래" />
          </div>
          <div className="vision-content">
            <div className="vision-title">
              <img src={process.env.PUBLIC_URL + "/images/icons8-electronics-52.png"} alt="아이콘" className="vision-icon" />
              <h3>글로벌 커뮤니케이션의 미래</h3>
            </div>
            <p>
              {formatText("언어의 장벽을 넘어 전 세계 사람들이 자유롭게 소통할 수 있는 미래를 그립니다. 우리의 기술은 이러한 미래를 앞당기는 데 기여할 것입니다.")}
            </p>
          </div>
        </div>

        <div className="vision-section">
          <div className="vision-image">
            <img src={process.env.PUBLIC_URL + "/images/global-avatar.jpg"} alt="AR-AR을 통합한 환경" />
          </div>
          <div className="vision-content">
            <div className="vision-title">
              <img src={process.env.PUBLIC_URL + "/images/icons8-electronics-52.png"} alt="아이콘" className="vision-icon" />
              <h3>플랫폼의 한계를 넘는 3D 캐릭터</h3>
            </div>
            <p>
              {formatText("멀티버스는 끝났다는 의견도 있지만 아직 오지 않은 미래라는 것이 진실입니다. Ai가 3D 캐릭터를 만들고 새로운 혁신을 이끌어가는 미래가 바로 곁에 있습니다.")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Vision;