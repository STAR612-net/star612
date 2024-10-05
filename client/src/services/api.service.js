import axios from 'axios';
import { API_CONFIG } from '../config/api.config';

const apiService = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: API_CONFIG.HEADERS
});

export const get = async (url, config = {}) => {
  try {
    const response = await apiService.get(url, config);
    return response.data;
  } catch (error) {
    console.error('GET request failed:', error);
    throw error;
  }
};

export const post = async (url, data, config = {}) => {
  try {
    const response = await apiService.post(url, data, config);
    return response.data;
  } catch (error) {
    console.error('POST request failed:', error);
    throw error;
  }
};

// 필요에 따라 put, delete 등의 메서드 추가