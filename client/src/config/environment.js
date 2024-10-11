const environment = {
    development: {
      apiUrl: 'http://localhost:5000/api',
    },
    production: {
      apiUrl: 'https://api.star612.net',  // 실제 프로덕션 API URL로 변경하세요
    },
    test: {
      apiUrl: 'http://star612.net:5000/api',  // 테스트 환경의 API URL
    }
  };
  
  const getEnvironment = () => {
    switch (process.env.REACT_APP_ENV) {
      case 'production':
        return environment.production;
      case 'test':
        return environment.test;
      default:
        return environment.development;
    }
  };
  
  export default getEnvironment();