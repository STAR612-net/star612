import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Header.css';

function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    // 라우트가 변경될 때마다 메뉴를 닫습니다.
    setIsMenuOpen(false);
  }, [location]);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <header className={`header ${isScrolled ? 'scrolled' : ''}`}>
      <div className="header-content">
        <Link to="/">
          <img 
            src={isScrolled ? "/images/logo-612c.png" : "/images/logo-612w.png"} 
            alt="612 로고" 
            className="logo" 
          />
        </Link>
        <nav className={`nav ${isMenuOpen ? 'open' : ''}`}>
          <ul>
            <li><Link to="/Vision">비전</Link></li>
            <li><Link to="/Team">팀소개</Link></li>
            <li><Link to="/Product">서비스</Link></li>
            <li><Link to="/Contact">CONTACT</Link></li>
          </ul>
        </nav>
        <div className={`auth-buttons ${isMenuOpen ? 'open' : ''}`}>
          <button className="login">로그인</button>
          <button className="signup">회원가입</button>
        </div>
        <button className={`hamburger ${isScrolled ? 'scrolled' : ''}`} onClick={toggleMenu}>
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
    </header>
  );
}

export default Header;