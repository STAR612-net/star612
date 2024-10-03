import React from 'react';
import './Footer.css';

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <img src="/images/logo-612w.png" alt="작은별612 로고" className="footer-logo" />
        <div className="footer-text">
          <span className="copyright">Copyright © 2024 작은별612 All rights reserved.</span>
          <span className="address">서울특별시 서대문구 연세로5나길 19 3층</span>
        </div>
      </div>
    </footer>
  );
}

export default Footer;