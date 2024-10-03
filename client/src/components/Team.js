import React from 'react';
import PageHeader from './PageHeader';
import './Team.css';

function Team() {
  const teamIntro = [
    { title: "혁신적인 AI", description: "최신 AI 기술을 활용한 언어 학습 서비스" },
    { title: "3D 캐릭터", description: "몰입감 있는 3D 캐릭터와의 상호작용" },
    { title: "맞춤형 학습", description: "개인화된 학습 경험과 피드백 제공" }
  ];

  const teamMembers = [
    { name: '박수형', role: '팀리더, 기획, 백엔드/프론트엔드 담당', description: 'AI 기반 서비스의 전체 아키텍처를 설계, 사용자 경험부터 백엔드 시스템 통합\n성장형 캐릭터 시스템을 기획, 학습성과 연계 캐릭터 육성 메커니즘을 설계\nAI 학습 모델, 데이터베이스, 사용자 인터페이스 등 효율적인 상호작용 설계.', image: 'd-0.png' },
    { name: '최원일', role: '기획 / 서비스 운영', description: '기획 및 운영으로 서비스 설계 및 홍보, 운영 담당.\n베타 테스트를 기획하고 실행하며, 사용자 피드백을 수집하여 서비스 개선에 반영\n서비스 운영 전략을 수립하고, 지속적인 모니터링 및 서비스 개선 작업을 수행', image: 'd-1.png' },
    { name: '황조현', role: 'AI 평가설계 / 프론트', description: 'AI 를 통한 학습설계 및 평가 프로세서 구성. 프론트엔드\n언어학습 기준과 데이터셋을 정의, 효과적인 프롬프트 엔지니어링 전략 수립\n최적의 명령어 리스트를 개발하고, 이상적인 출력값 기준을 설정 및 설계', image: 'd-2.png' },
    { name: '진영록', role: '프로그래머/백엔드, DB 설계', description: '백엔드 코딩과 DB 설계 및 최적화, AI 학습 및 데이터 관리\nmongoDB 및 데이터베이스 관계형 DB와 NoSQL을 활용하여 구현\n데이터의 처리, 대용량 처리, 머신러닝 모델 연동을 위한 백엔드 시스템', image: 'd-3.png' },
    { name: '이효림', role: '캐릭터 관리 / 백엔드', description: '3D 캐릭터의 학습 및 레벨 기반 성장 시스템을 설계하여 웹 서비스에 통합.\n캐릭터 성장 로직을 구현하고, MySQL 데이터베이스로 캐릭터 데이터를 관리.\nRESTful API를 개발 및 프론트엔드와 백엔드 간의 효율적인 네트워크 구현.', image: 'd-4.png' },
    { name: '박수현', role: '자문 / 보안 및 기술 자문', description: '네트워크 보안 전문가로 국내 모보안기업 수석연구원 및 다수 IT벤처 자문.\n사용자 데이터 암호화, 안전한 데이터 전송 프로토콜 구현, 접근 제어 시스템 등 자문\n언어학습 서비스의 개인정보 보호 정책 및 보안 취약점 분석 등 자문', image: 'd-5.png', isAdvisor: true },
  ];

  return (
    <div className="team-page">
      <PageHeader 
        title="Our Team" 
        subtitle="혁신적인 AI 언어 학습 서비스를 만들어가는 작은별612 팀을 소개합니다" 
        backgroundImage={process.env.PUBLIC_URL + "/images/team-bg.jpg"}
      />
      <div className="team-container">
        <h2 className="team-intro">
          <span className="highlight">작은별612</span> 팀은
        </h2>
        <div className="team-separator"></div>
        <p className="team-description">
          서울청년취업사관학교 새싹 풀스텍 코드 부트캠프 참여자들이 핵심 구성원으로 있으며, 안랩 수석연구원 출신 박수현 강사의 지도와 창업 지원을 받고 있습니다.
        </p>
        <p className="team-description">
          현재 3D 캐릭터와 생성형 AI(llama3)를 연동한 대화 중심의 영어회화 서비스를 개발 중입니다. 이 서비스는 웹, AR, VR과 연동 가능한 [영어/한글학습(예정)]과 [캐릭터 육성] 서비스를 준비합니다.
        </p>
        
        <div className="team-intro-boxes">
          {teamIntro.map((item, index) => (
            <React.Fragment key={index}>
              <div className="team-intro-box">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              {index < teamIntro.length - 1 && <div className="plus-sign">+</div>}
            </React.Fragment>
          ))}
        </div>
        
        <div className="team-members">
          {teamMembers.map((member, index) => (
            <div key={index} className="team-member">
              <img src={process.env.PUBLIC_URL + `/images/${member.image}`} alt={member.name} className="member-image" />
              <div className="member-info">
                <h3 className={member.isAdvisor ? 'advisor-name' : ''}>{member.name}</h3>
                <h4>{member.role}</h4>
                <p>{member.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Team;