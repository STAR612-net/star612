import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Main from './components/Main';
import Team from './components/Team';
import Vision from './components/Vision';
import Product from './components/Product';
import Contact from './components/Contact';
import Footer from './components/Footer';
import AvatarDetails from './components/AvatarDetails';
import './App.css';

function App() {
  return (
    <Router>
    <div className="App">
      <Header />
      <Routes>
        <Route path="/" element={<Main />} />
        <Route path="/team" element={<Team />} />
        <Route path="/vision" element={<Vision />} />
        <Route path="/product" element={<Product />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/avatar-details" element={<AvatarDetails />} />
      </Routes>
      <Footer />
    </div>
  </Router>
  );
}

export default App;