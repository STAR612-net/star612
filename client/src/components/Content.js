import React from 'react';

function Content() {
  return (
    <section className="content">
      <div className="section">
        <img src="/images/section1.jpg" alt="섹션 1 이미지" />
        <div className="text">
          <h2>섹션 1 제목</h2>
          <p>섹션 1 내용...</p>
        </div>
      </div>
      <div className="section reverse">
        <div className="text">
          <h2>섹션 2 제목</h2>
          <p>섹션 2 내용...</p>
        </div>
        <img src="/images/section2.jpg" alt="섹션 2 이미지" />
      </div>
      {/* 추가 섹션들... */}
    </section>
  );
}

export default Content;