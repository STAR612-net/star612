import env from './environment';

export const API_CONFIG = {
  BASE_URL: process.env.REACT_APP_API_URL || env.apiUrl,
  TIMEOUT: 5000,  // 5초
  HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
};