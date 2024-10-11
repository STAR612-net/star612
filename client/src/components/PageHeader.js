import React from 'react';
import './PageHeader.css';

function PageHeader({ title, subtitle, backgroundImage }) {
  return (
    <div className="page-header" style={{ backgroundImage: `url(${backgroundImage})` }}>
      <div className="page-header-content">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export default PageHeader;